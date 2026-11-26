import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';

// Feed JSON lines on stdin. The child uses the same local IPC channel to reply.
const exe=process.env.ARCHI_CHECK_EXE;
const root=path.resolve(import.meta.dirname,'..');
const executable=exe||(await import('electron')).default;
const child=spawn(executable,[...(exe?[]:[root]),'--archi-check-api'],{
  cwd:root,windowsHide:true,stdio:['ignore','ignore','inherit','ipc'],
  env:{...process.env,ARCHI_TELEMETRY_DISABLED:'1'}
});
let pending,ready;
const startup=new Promise((resolve,reject)=>{ready={resolve,reject};});
const startupTimer=setTimeout(()=>ready.reject(new Error('Check API did not start. Use a build with check API support and an available profile.')),45000);
function disconnected(error){
  ready.reject(error);
  pending?.reject(error);
}
child.on('error',disconnected);
child.on('exit',()=>disconnected(new Error('Check process exited. Its profile may already be open.')));
child.on('message',message=>{
  if(message.type==='archi-ready')ready.resolve();
  if(message.type==='archi-check-result'&&message.id===pending?.id)pending.resolve(message);
});
try {
  const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
  // Start iterating immediately so piped requests survive application startup.
  const lines=input[Symbol.asyncIterator]();
  await startup;
  clearTimeout(startupTimer);
  for await (const line of lines){
    if(!line.trim())continue;
    try {
      const data=JSON.parse(line),id=randomUUID();
      const response=await new Promise((resolve,reject)=>{
        pending={id,resolve,reject};
        child.send({...data,type:'archi-check',id},error=>{if(error)reject(error);});
      });
      delete response.type;delete response.id;
      console.log(JSON.stringify(response));
      if(!response.ok||['error','approval_required','timeout'].includes(response.result?.status))process.exitCode=1;
    } catch(error) {
      console.log(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;
    } finally {pending=null;}
  }
} catch(error){console.error(error.message);process.exitCode=1;}
finally {
  clearTimeout(startupTimer);
  if(child.connected){
    const closed=once(child,'exit');
    child.disconnect();
    const timer=setTimeout(()=>child.kill(),10000);
    try {await closed;} finally {clearTimeout(timer);}
  }
}

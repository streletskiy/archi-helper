import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { t } from '../locales/index.mjs';
import { uid, projectPath } from './store.mjs';
import { CATALOG_PATH } from './api-catalog.mjs';

export async function runPython({store,mcp,session,code,timeoutSeconds=300,signal}) {
  if(!Number.isInteger(timeoutSeconds)||timeoutSeconds<1||timeoutSeconds>1800)throw new Error(t('agent.invalidPythonTimeout'));
  const root=await store.workspace(session.projectId,session.id);
  const script=await projectPath(root,`.archi/scripts/${uid()}.py`),log=script.replace(/\.py$/,'.log');
  const temporary=await projectPath(root,'.archi/tmp');
  await fs.mkdir(path.dirname(script),{recursive:true});await fs.mkdir(temporary,{recursive:true});
  await fs.writeFile(script,code,'utf8');await fs.writeFile(log,'','utf8');
  const env={...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONFAULTHANDLER:'1',PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',NO_PROXY:'localhost,127.0.0.1',
    ARCHI_UV:path.join(mcp.runtime,'uv.exe'),UV_PYTHON:mcp.python,UV_PYTHON_DOWNLOADS:'never',ARCHI_API_CATALOG:await projectPath(root,CATALOG_PATH),
    ARCHI_PROJECT_DIR:store.project(session.projectId).path,ARCHI_WORK_DIR:root,ARCHI_PROJECT_ID:session.projectId,ARCHI_SESSION_ID:session.id,
    ARCHI_LEGACY_DIR:path.join(store.projectStorage(session.projectId),'legacy'),TEMP:temporary,TMP:temporary,TMPDIR:temporary};
  if(mcp.port)env.ARCHICAD_PORT=String(mcp.port);else delete env.ARCHICAD_PORT;
  const pathKey=Object.keys(env).find(key=>key.toUpperCase()==='PATH')||'PATH';
  env[pathKey]=[path.dirname(mcp.python),mcp.runtime,env[pathKey]||''].join(path.delimiter);
  for(const key of Object.keys(env))if(/(?:api.?key|token|secret|password|credential)/i.test(key))delete env[key];
  signal.throwIfAborted();
  const started=Date.now();
  return new Promise(resolve=>{
    let preview='',tail='',stderr='',total=0,chars=0,reason='',spawnError,logError,write=Promise.resolve();
    const decoders={stdout:new StringDecoder('utf8'),stderr:new StringDecoder('utf8')};
    const child=spawn(mcp.python,['-u',script],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const capture=(text,stream)=>{chars+=text.length;preview+=text.slice(0,Math.max(0,20000-preview.length));tail=(tail+text).slice(-4000);if(stream==='stderr')stderr=(stderr+text).slice(-6000);};
    const output=(chunk,stream)=>{
      total+=chunk.length;capture(decoders[stream].write(chunk),stream);
      write=write.then(()=>fs.appendFile(log,chunk)).catch(error=>{logError=error;});
    };
    child.stdout.on('data',chunk=>output(chunk,'stdout'));child.stderr.on('data',chunk=>output(chunk,'stderr'));
    const kill=why=>{
      if(reason)return;reason=why;
      if(process.platform==='win32'&&child.pid) {
        const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
        killer.on('error',()=>child.kill());killer.on('close',code=>{if(code)child.kill();});
      }else child.kill();
    };
    const abort=()=>kill('cancelled');signal.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>kill('timeout'),timeoutSeconds*1000);
    if(signal.aborted)abort();
    child.on('error',error=>{spawnError=error;});
    child.on('close',async(exitCode,exitSignal)=>{
      clearTimeout(timer);signal.removeEventListener('abort',abort);
      for(const stream of ['stdout','stderr'])capture(decoders[stream].end(),stream);
      await write;
      const isError=!!reason||!!spawnError||!!logError||exitCode!==0;
      const exception=[...stderr.matchAll(/^([\w.]+(?:Error|Exception)|KeyboardInterrupt|SystemExit):.*$/gm)].at(-1)?.[0];
      const error=reason==='timeout'?t('agent.pythonTimedOut',{seconds:timeoutSeconds}):reason==='cancelled'?t('agent.pythonCancelled'):
        spawnError?.message||logError?.message||(isError?(exception||t('agent.pythonExited',{code:exitCode??exitSignal??'unknown'})):undefined);
      resolve({exitCode,isError,...(error?{error}:{}),termination:reason||(spawnError?'start-error':logError?'log-error':isError?'exit-error':'completed'),durationMs:Date.now()-started,timeoutSeconds,
        output:chars>20000?`${preview.slice(0,16000)}\n…\n${tail}`:preview,
        stderr,bytes:total,log:path.relative(root,log).replaceAll('\\','/'),script:path.relative(root,script).replaceAll('\\','/'),
        ...(isError?{warning:t('agent.theProcessStoppedCheckTheOutcomeCompleted')}:{}),...(reason?{outcomeUnknown:true}:{})});
    });
  });
}

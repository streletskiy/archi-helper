import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {INBOX_ID} from './store.mjs';

// Only the parent that launched this process with a private Node IPC channel can call it.
export function startCheckApi({app,agent,store,mcp,send}) {
  async function handle({method,text,pid,sessionId}) {
    if(pid!==undefined&&(!Number.isSafeInteger(pid)||pid<=0))throw new Error('Invalid 3ds Max PID');
    if(method==='status'){
      const state=await mcp.max.refresh(true);
      return {version:app.getVersion(),max:{status:state.status,instances:state.instances.map(({pid,year,ready})=>({pid,year,ready}))},archicadConnected:!!mcp.connectionInfo?.archicad_version};
    }
    if(method==='tools')return mcp.max.discover({},undefined,pid);
    if(!['viewport','chat'].includes(method))throw new Error('Unknown check method');
    if(method==='chat'&&(typeof text!=='string'||!text.trim()||text.length>24000))throw new Error('Expected chat text');
    const projectId=INBOX_ID;
    const session=sessionId?await agent.load(projectId,sessionId):await store.newSession(projectId);
    const workspace=await store.workspace(projectId,session.id);
    if(method==='viewport'){
      const image=await agent.runDirect({projectId,sessionId:session.id},(s,c)=>agent.execute(s,'call_3dsmax',
        {name:'capture_viewport',arguments:{},pid},'read',c.signal));
      if(!image.imagePath)throw new Error(image.error||'Viewport capture failed');
      return {sessionId:session.id,png:path.join(workspace,image.imagePath)};
    }
    if(pid!==undefined){
      const selected=await mcp.max.target(session,pid);
      session.maxTarget=mcp.max.key(selected);
      await store.saveSession(session);
    }
    const {providerId,model,permissionMode}=store.state;
    if(!providerId||!model)throw new Error('Select a provider and model in the check profile first');
    const queued=await send({projectId,sessionId:session.id,text,providerId,model,mode:permissionMode||'review'});
    const deadline=Date.now()+300000;
    while(agent.activeSession===session.id&&agent.running){
      if(agent.approval?.sessionId===session.id||Date.now()>=deadline){
        const reason=agent.approval?'approval_required':'timeout';
        await agent.stop({projectId,sessionId:session.id});
        return {sessionId:session.id,status:reason,workspace};
      }
      await delay(200);
    }
    const done=await agent.snapshot(projectId,session.id);
    const start=done.messages.findIndex(m=>m.requestId===queued.id);
    if(start<0)throw new Error('Chat request remains queued in session '+session.id);
    const messages=done.messages.slice(start+1).filter(m=>['assistant','error','notice','tool'].includes(m.role));
    const status=messages.some(m=>m.role==='error')?'error':'completed';
    return {sessionId:session.id,status,workspace,messages:messages.map(({role,name,status,text})=>({role,name,status,text}))};
  }
  let busy=false;
  process.on('message',async request=>{
    if(request?.type!=='archi-check'||typeof request.id!=='string')return;
    const reply=(body)=>{if(process.connected)process.send({type:'archi-check-result',id:request.id,...body});};
    if(busy){reply({ok:false,error:'Another check is running'});return;}
    busy=true;
    try {reply({ok:true,result:await handle(request)});}
    catch(error){reply({ok:false,error:error.message});}
    finally {busy=false;}
  });
  process.once('disconnect',()=>app.quit());
}

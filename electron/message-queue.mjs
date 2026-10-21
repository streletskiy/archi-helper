import fs from 'node:fs/promises';
import {uid} from './store.mjs';
import {t} from '../locales/index.mjs';

// One owner for the live session and its persisted inbox. Queue edits and
// consumption are serialized; tool execution never holds this lock.
export class MessageQueue {
  constructor(store,emit){this.store=store;this.emit=emit;this.requests=Promise.resolve();this.running=null;this.liveSession=null;this.activeSession=null;this.activeProject=null;this.steerable=false;}
  locked(action){const result=this.requests.then(action);this.requests=result.catch(()=>{});return result;}
  sameSession(projectId,sessionId){return this.liveSession?.projectId===projectId&&this.liveSession?.id===sessionId;}
  async load(projectId,sessionId){
    if(this.running&&!this.sameSession(projectId,sessionId))throw new Error(t('errors.anotherSessionRunning'));
    const session=this.sameSession(projectId,sessionId)?this.liveSession:await this.store.session(projectId,sessionId);
    session.pendingMessages??=[];return session;
  }
  publishQueue(session){this.emit({type:'queue',sessionId:session.id,pendingMessages:structuredClone(session.pendingMessages),queuePaused:session.queuePaused===true});}
  get hasSteering(){return this.steerable&&!this.liveSession?.queuePaused&&this.liveSession?.pendingMessages.some(item=>item.delivery==='steer');}
  async snapshot(projectId,sessionId){return this.locked(async()=>{
    const session=this.sameSession(projectId,sessionId)?this.liveSession:await this.store.session(projectId,sessionId);
    if(!this.running){
      let changed=false;
      for(const message of session.messages)if(message.status==='running'){message.status='error';message.text=t('errors.theAppClosedDuringAnOperationThe');changed=true;}
      if(changed)this.repair(session.history);
      if(session.pendingMessages?.length){session.queuePaused=true;for(const item of session.pendingMessages)item.delivery='queue';changed=true;}
      if(changed)await this.store.saveSession(session);
    }
    return structuredClone(session);
  });}
  async enqueue(input){return this.locked(async()=>{
    const session=await this.load(input.projectId,input.sessionId),id=input.id||uid();
    if(!/^[a-f0-9-]{36}$/.test(id))throw new Error(t('errors.invalidQueuedMessage'));
    if(session.pendingMessages.some(item=>item.id===id)||session.messages.some(item=>item.requestId===id))return {id};
    const text=typeof input.text==='string'?input.text.trim():'';
    const attachments=Array.isArray(input.attachments)?[...new Set(input.attachments)]:[];
    if(!text&&!attachments.length)throw new Error(t('errors.enterATask'));
    if(session.pendingMessages.length>=20)throw new Error(t('errors.messageQueueFull'));
    if(!['queue','steer',undefined].includes(input.delivery)||!['read','review','full'].includes(input.mode))throw new Error(t('errors.invalidQueuedMessage'));
    this.store.getProvider(input.providerId);
    if(typeof input.model!=='string'||!input.model.trim())throw new Error(t('ui.chooseAModel'));
    for(const relative of attachments){const {file}=await this.store.resolveFile(input.projectId,input.sessionId,relative);if(!(await fs.stat(file)).isFile())throw new Error(t('errors.expectedAFileName'));}
    const paused=session.queuePaused;
    if(!this.running)session.queuePaused=session.pendingMessages.length>0;
    const delivery=input.delivery==='steer'&&this.running&&this.steerable&&!session.queuePaused?'steer':'queue';
    const item={id,text,attachments,providerId:input.providerId,model:input.model,mode:input.mode,reasoningEffort:this.store.state.reasoningEffort,delivery,at:Date.now()};
    session.pendingMessages.push(item);
    try{await this.store.saveSession(session);}catch(error){session.pendingMessages.pop();session.queuePaused=paused;throw error;}
    this.publishQueue(session);
    if(delivery==='steer')this.interrupt();
    if(!this.running&&!session.queuePaused)this.start(session);
    return {id};
  });}
  appendUser(session,item){
    const text=item.text+(item.attachments.length?t('ui.materialsInTheProjectFolder',{value0:item.attachments.map(file=>`- ${file}`).join('\n')}):'');
    const message={id:uid(),requestId:item.id,role:'user',text,at:Date.now()};
    session.messages.push(message);session.history.push({role:'user',content:text});
    if(session.messages.filter(message=>message.role==='user').length===1)session.title=(item.text||item.attachments[0]).slice(0,55);
    return message;
  }
  start(session){
    const controller=new AbortController();this.running=controller;this.liveSession=session;this.activeSession=session.id;this.activeProject=session.projectId;this.steerable=true;
    this.emit({type:'busy',busy:true,sessionId:session.id,projectId:session.projectId,canSteer:true});
    this.launchDrain(session,controller);
  }
  launchDrain(session,controller){
    this.drain(session,controller).catch(async error=>{
      this.emit({type:'queue-error',sessionId:session.id,message:error.message});
      await this.locked(()=>this.finish(session,controller,true)).catch(()=>{});
    });
  }
  async drain(session,controller){
    while(this.running===controller){
      const item=await this.locked(async()=>{
        if(controller.signal.aborted||session.queuePaused||!session.pendingMessages.length){await this.finish(session,controller,controller.signal.aborted||session.queuePaused);return null;}
        const item=session.pendingMessages.shift(),title=session.title;
        const message=this.appendUser(session,item);
        try{await this.store.saveSession(session);}catch(error){session.pendingMessages.unshift(item);session.messages.pop();session.history.pop();session.title=title;throw error;}
        this.steerable=true;
        this.emit({type:'busy',busy:true,sessionId:session.id,projectId:session.projectId,canSteer:true});
        this.emit({type:'message',sessionId:session.id,message});this.publishQueue(session);return item;
      });
      if(!item)return;
      if(!await this.performTask(session,item,controller.signal))await this.locked(async()=>{session.queuePaused=true;});
    }
  }
  async takeSteering(session){return this.locked(async()=>{
    if(this.running?.signal.aborted||session.queuePaused)return false;
    const pending=session.pendingMessages,items=pending.filter(item=>item.delivery==='steer');
    if(!items.length)return false;
    session.pendingMessages=pending.filter(item=>item.delivery!=='steer');
    const messages=items.map(item=>this.appendUser(session,item));
    try{await this.store.saveSession(session);}catch(error){session.pendingMessages=pending;session.messages.splice(-items.length);session.history.splice(-items.length);throw error;}
    for(const message of messages)this.emit({type:'message',sessionId:session.id,message});
    this.publishQueue(session);return true;
  });}
  async changeQueued({projectId,sessionId,id,action}){return this.locked(async()=>{
    const session=await this.load(projectId,sessionId),index=session.pendingMessages.findIndex(item=>item.id===id);
    if(index<0)throw new Error(t('errors.queuedMessageAlreadyStarted'));
    const before=structuredClone(session.pendingMessages),paused=session.queuePaused,item=session.pendingMessages[index];
    if(action==='remove')session.pendingMessages.splice(index,1);
    else if(action==='steer'){
      if(this.running){
        if(session.queuePaused||!this.steerable)throw new Error(t('errors.queueStopping'));
        item.delivery='steer';
      }else{session.pendingMessages.splice(index,1);session.pendingMessages.unshift(item);session.queuePaused=false;}
    }else throw new Error(t('errors.invalidQueuedMessage'));
    try{await this.store.saveSession(session);}catch(error){session.pendingMessages=before;session.queuePaused=paused;throw error;}
    this.publishQueue(session);
    if(action==='steer'){if(this.running)this.interrupt();else this.start(session);}
    return structuredClone(item);
  });}
  async resume({projectId,sessionId}){return this.locked(async()=>{
    const session=await this.load(projectId,sessionId);
    if(this.running)throw new Error(t('errors.queueStopping'));
    session.queuePaused=false;for(const item of session.pendingMessages)item.delivery='queue';
    await this.store.saveSession(session);this.publishQueue(session);
    if(session.pendingMessages.length)this.start(session);
    return true;
  });}
  async finish(session,controller,paused){
    if(this.running!==controller)return;
    try{
      if(paused){session.queuePaused=true;for(const item of session.pendingMessages)item.delivery='queue';await this.store.saveSession(session);}
    }finally{
      this.running=null;this.liveSession=null;this.activeSession=null;this.activeProject=null;this.steerable=false;
      this.publishQueue(session);this.emit({type:'busy',busy:false,sessionId:session.id,projectId:session.projectId,canSteer:false});
    }
  }
  async stop(input={}){
    if(input.sessionId&&this.running&&!this.sameSession(input.projectId,input.sessionId))throw new Error(t('errors.anotherSessionRunning'));
    const session=this.liveSession;
    if(!session)return true;
    session.queuePaused=true;this.running?.abort();
    return this.locked(async()=>{for(const item of session.pendingMessages)item.delivery='queue';await this.store.saveSession(session);this.publishQueue(session);return true;});
  }
  async runDirect({projectId,sessionId},operation){
    let session,controller;
    await this.locked(async()=>{
      if(this.running)throw new Error(t('errors.waitForTheTaskToFinish'));
      session=await this.load(projectId,sessionId);controller=new AbortController();
      session.queuePaused=session.pendingMessages.length>0;
      this.running=controller;this.liveSession=session;this.activeSession=sessionId;this.activeProject=projectId;this.steerable=false;
      this.emit({type:'busy',busy:true,sessionId,projectId,canSteer:false});
    });
    let success=false;
    try{const result=await operation(session,controller);success=result.status!=='error';return result;}
    finally{await this.locked(async()=>{
      if(success&&!controller.signal.aborted&&!session.queuePaused&&session.pendingMessages.length){this.steerable=true;this.launchDrain(session,controller);}
      else await this.finish(session,controller,!success||controller.signal.aborted||session.queuePaused);
    });}
  }
}

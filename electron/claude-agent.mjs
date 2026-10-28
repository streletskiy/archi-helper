import { uid } from './store.mjs';
import { t } from '../locales/index.mjs';
import { systemMessage } from './instructions.mjs';
import { saveApiCatalog,catalogSummary } from './api-catalog.mjs';
import { currentObservation } from './telemetry-context.mjs';
import { claudeBridge } from './claude-bridge.mjs';
import { claudeTurn } from './claude-code.mjs';
import { compactSession,reduceContextLimit } from './context.mjs';

export async function performClaudeTask(agent,session,{provider,model,mode,knowledge,text,attachments,tools},signal) {
  const store=agent.store,workspace=await store.workspace(session.projectId,session.id);
  const catalog=await saveApiCatalog(agent.mcp,workspace),emit=e=>agent.emit({...e,sessionId:session.id});
  agent.selectedKnowledge=new Map(knowledge.map(entry=>[entry.id,entry]));
  let query=[text,...attachments].join(' '),overflowRetries=0;
  while(true) {
    signal.throwIfAborted();
    const corrections=await agent.takeSteering(session);
    if(corrections)for(const item of corrections){query=(item.text+' '+query).slice(0,8000);for(const entry of item.knowledge||[])agent.selectedKnowledge.set(entry.id,entry);}
    agent.repair(session.history);
    const reference=await agent.knowledge.context(session.projectId,agent.mcp.connectionInfo,{query,selected:[...agent.selectedKnowledge.keys()]});
    currentObservation()?.knowledgeUsed([...agent.selectedKnowledge.keys()],'selected');
    currentObservation()?.knowledgeUsed(reference.automatic.map(entry=>entry.id),'automatic');
    const system=systemMessage(store.project(session.projectId).path,true,mode,catalogSummary(catalog),{workspace,legacyProjectFiles:session.legacyProjectFiles,knowledge:reference.summary});
    const history=await agent.prepareMessages(session.history,session,true);
    if(agent.hasSteering)continue;
    const controller=new AbortController(),turnSignal=AbortSignal.any([signal,controller.signal]);
    agent.completionController=controller;
    let queue=Promise.resolve(),streamKey,observedText=false;
    const streams=new Map(),committed=new Set(),measurement=currentObservation()?.generation(provider,model);
    const enqueue=action=>{const result=queue.then(action);queue=result.catch(()=>{});return result;};
    const commit=async(key,text)=>{
      if(!text||committed.has(key))return;
      committed.add(key);const stream=streams.get(key);streams.delete(key);
      const message={id:stream?.id||uid(),role:'assistant',text,at:Date.now(),model};
      session.messages.push(message);session.history.push({role:'assistant',content:text});observedText=true;
      await store.saveSession(session);emit({type:'message',message});
    };
    const bridge=await claudeBridge(tools,(name,args)=>enqueue(async()=>{
      signal.throwIfAborted();
      if(agent.hasSteering||turnSignal.aborted)throw new Error(t('agent.actionSuperseded'));
      // A correction cancels inference, never an operation already in progress.
      agent.completionController=null;
      try {
        const call={id:uid(),type:'function',function:{name,arguments:JSON.stringify(args)}};
        session.history.push({role:'assistant',content:null,tool_calls:[call]});await store.saveSession(session);
        const outcome=await agent.runToolCall(session,call,mode,signal,provider,model,emit);
        const content=[{type:'text',text:outcome.content}];
        for(const part of outcome.images)if(part.type==='image_url') {
          const relative=part.image_url.url.slice('archi-file:'.length),{mime,data}=await store.image(session.projectId,session.id,relative);
          content.push({type:'image',mimeType:mime,data:data.toString('base64')});
        }
        if(outcome.images.length)session.history.push({role:'user',content:outcome.images,_attachment:true});
        await store.saveSession(session);
        return {content,isError:outcome.isError};
      } finally {
        agent.completionController=controller;
        if(agent.hasSteering)controller.abort();
      }
    }),turnSignal);
    let failure;
    try {
      const result=await claudeTurn({manager:store.claudeCode,provider,model,signal:turnSignal,
        messages:[{role:'system',content:system},...(reference.text?[{role:'user',content:reference.text}]:[]),...history],
        toolsConfig:bridge.config,allowedTools:tools.map(tool=>`mcp__archi__${tool.function.name}`),
        onEvent:event=>enqueue(async()=>{
          if(turnSignal.aborted)return;
          if(event.type==='stream_event'&&!event.parent_tool_use_id) {
            const value=event.event;
            if(value?.type==='message_start'){streamKey=value.message.id;streams.set(streamKey,{id:uid(),text:''});}
            if(value?.type==='content_block_delta'&&value.delta?.type==='text_delta') {
              const stream=streams.get(streamKey);if(!stream)return;
              stream.text+=value.delta.text;measurement?.delta();emit({type:'delta',id:stream.id,delta:value.delta.text});
            }
            if(value?.type==='message_stop') {
              const stream=streams.get(streamKey);
              if(stream?.text)await commit(streamKey,stream.text);
              else if(stream){emit({type:'stream-reset',id:stream.id});streams.delete(streamKey);}
            }
          }
          if(event.type==='assistant'&&!event.parent_tool_use_id&&!event.error) {
            const key=event.message?.id;if(!key||committed.has(key)||streams.has(key))return;
            // The CLI can emit separate assistant blocks with the same message
            // ID. Streaming message_stop is authoritative when available.
            const text=(event.message.content||[]).filter(part=>part.type==='text').map(part=>part.text).join('');
            if(text)await commit(event.uuid||key,text);
          }
        })});
      measurement?.usage(result.usage);
      if(!observedText)throw new Error(t('agent.theModelReturnedAnEmptyResponseCheck'));
      if(agent.hasSteering)continue;
      agent.steerable=false;return true;
    } catch(error) {
      failure=error;
      if(controller.signal.aborted&&!signal.aborted&&agent.hasSteering)continue;
      if(error.contextOverflow&&overflowRetries++<3&&!signal.aborted) {
        reduceContextLimit(session,provider,model,error);
        const complete=async(_provider,_model,messages,_tools,compactSignal)=>{
          let content='';
          await claudeTurn({manager:store.claudeCode,provider,model,messages,signal:compactSignal,onEvent:async event=>{
            if(event.type==='assistant'&&!event.error)content+=(event.message?.content||[]).filter(part=>part.type==='text').map(part=>part.text).join('');
          }});
          return {role:'assistant',content};
        };
        if(await compactSession({store,session,provider,model,signal,force:true,complete}))emit({type:'message',message:await agent.contextNotice(session)});
        continue;
      }
      throw error;
    } finally {
      controller.abort();await queue;await bridge.close();
      for(const stream of streams.values())emit({type:'stream-reset',id:stream.id});
      if(agent.completionController===controller)agent.completionController=null;
      measurement?.end(failure,signal);
    }
  }
}

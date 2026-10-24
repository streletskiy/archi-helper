import { t } from '../locales/index.mjs';
import { reasoningProfile, selectedEffort } from './reasoning.mjs';

const namespace='archi';
const binding=(provider,model)=>`${provider.id}:${provider.oauth?.connectionId||''}:${model}`;
export function responseInput(provider,model,messages) {
  const input=[],instructions=[];
  for(const message of messages) {
    if(message.role==='system'||message.role==='developer'){instructions.push(String(message.content||''));continue;}
    if(message.role==='tool'){input.push({type:'function_call_output',call_id:message.tool_call_id,output:String(message.content??'')});continue;}
    if(message.role==='assistant'&&message._responseBinding===binding(provider,model)&&Array.isArray(message._responseItems)) {
      input.push(...message._responseItems);continue;
    }
    if(message.content) {
      const content=Array.isArray(message.content)?message.content.map(part=>{
        if(part.type==='text')return {type:'input_text',text:part.text};
        if(part.type==='image_url'&&message.role==='user')return {type:'input_image',image_url:part.image_url.url,detail:part.image_url.detail||'auto'};
        throw new Error(t('errors.responsesInputUnsupported'));
      }):message.content;
      input.push({role:message.role,content});
    }
    for(const call of message.tool_calls||[])input.push({type:'function_call',call_id:call.id,namespace,name:call.function.name,arguments:call.function.arguments});
  }
  return {input,...(instructions.length?{instructions:instructions.join('\n\n')}:{})};
}

export async function responsesCompletion(provider,model,messages,tools,signal,onDelta,preferred,onUsage,api,providerError) {
  const effort=selectedEffort(reasoningProfile(provider,model).efforts,preferred);
  const body={model,...responseInput(provider,model,messages),store:false,stream:true,include:['reasoning.encrypted_content'],
    ...(effort?{reasoning:{effort}}:{}),...(tools.length?{tools:[{type:'namespace',name:namespace,
      description:'Local Archi Helper tools. Follow the tool descriptions and current user permissions.',
      tools:tools.map(tool=>({type:'function',name:tool.function.name,description:tool.function.description,
        parameters:tool.function.parameters,strict:false}))}]}:{})};
  const response=await api(provider,'responses',{method:'POST',signal,body:JSON.stringify(body)});
  // Some proxy paths omit Content-Type. The stream still has to contain a valid
  // response.completed event before any tool call can be returned for execution.
  const contentType=response.headers.get('content-type');
  if(contentType&&!contentType.includes('text/event-stream'))throw new Error(t('errors.responsesStreamRequired'));
  let completed,buffer='',lines=[];
  const finishedItems=new Map(),pendingItems=new Set();
  const decoder=new TextDecoder();
  const event=()=>{
    if(!lines.length)return;
    const data=lines.join('\n');lines=[];
    if(data==='[DONE]')return;
    const value=JSON.parse(data);
    if(value.type==='error'||value.error||['response.failed','response.incomplete'].includes(value.type))
      throw providerError(provider,null,JSON.stringify(value.response?.error||value.error||value.response?.incomplete_details||value));
    if(value.type==='response.output_text.delta'&&typeof value.delta==='string')onDelta(value.delta);
    if(['response.output_item.added','response.output_item.done'].includes(value.type)) {
      const index=value.output_index;
      if(completed||!Number.isSafeInteger(index)||index<0||!value.item||typeof value.item.type!=='string'||finishedItems.has(index))throw new Error(t('errors.responsesIncomplete'));
      if(value.type==='response.output_item.added')pendingItems.add(index);
      else {finishedItems.set(index,value.item);pendingItems.delete(index);}
    }
    if(value.type==='response.completed') {
      if(completed||value.response?.status!=='completed'||!Array.isArray(value.response.output))throw new Error(t('errors.responsesIncomplete'));
      completed=value.response;
    }
  };
  const line=value=>{value=value.replace(/\r$/,'');if(!value)event();else if(value.startsWith('data:'))lines.push(value.slice(5).trimStart());};
  for await(const chunk of response.body) {
    buffer+=decoder.decode(chunk,{stream:true});
    let index;while((index=buffer.indexOf('\n'))!==-1){line(buffer.slice(0,index));buffer=buffer.slice(index+1);}
  }
  buffer+=decoder.decode();if(buffer)line(buffer);event();
  if(!completed)throw new Error(t('errors.responsesIncomplete'));
  // A completed envelope may omit items already delivered by the stream. Only
  // finalized items are reusable; deltas and added items can still be partial.
  const output=completed.output.length?completed.output:[...finishedItems].sort(([a],[b])=>a-b).map(([index,item],position)=>{
    if(pendingItems.size||index!==position)throw new Error(t('errors.responsesIncomplete'));
    return item;
  });
  if(!completed.output.length&&pendingItems.size)throw new Error(t('errors.responsesIncomplete'));
  const calls=[],ids=new Set(),allowed=new Set(tools.map(tool=>tool.function.name));let content='';
  for(const item of output) {
    if(item.status==='incomplete'||item.status==='in_progress')throw new Error(t('errors.responsesIncomplete'));
    if(item.type==='message')for(const part of item.content||[])content+=part.type==='output_text'?part.text:part.type==='refusal'?part.refusal:'';
    if(item.type==='function_call') {
      if(!item.call_id||ids.has(item.call_id)||item.namespace!==namespace||!allowed.has(item.name)||
        item.status==='incomplete'||item.status==='in_progress'||typeof item.arguments!=='string')throw new Error(t('errors.theProviderReturnedAnIncompleteToolCall'));
      const args=JSON.parse(item.arguments);
      if(!args||typeof args!=='object'||Array.isArray(args))throw new Error(t('errors.theProviderReturnedInvalidToolArguments'));
      ids.add(item.call_id);calls.push({id:item.call_id,type:'function',function:{name:item.name,arguments:item.arguments}});
    }
  }
  if(completed.usage)onUsage({prompt_tokens:completed.usage.input_tokens,completion_tokens:completed.usage.output_tokens,
    total_tokens:completed.usage.total_tokens,prompt_tokens_details:completed.usage.input_tokens_details,
    completion_tokens_details:completed.usage.output_tokens_details});
  return {role:'assistant',content:content||null,...(calls.length?{tool_calls:calls}:{}),
    _responseItems:output.filter(item=>['message','reasoning','function_call'].includes(item.type)),_responseBinding:binding(provider,model)};
}

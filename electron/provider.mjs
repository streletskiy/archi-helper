import { t } from '../locales/index.mjs';
import { modelInfo, reasoningOptions, reasoningProfile } from './reasoning.mjs';
import { enrichModels } from './model-catalog.mjs';
const noStreamUsage=new Set();
function providerError(provider,status,text) {
  text=text.slice(0,1500).replaceAll(provider.apiKey || '\0',t('errors.redacted'));
  const error=new Error(status?t('errors.providerHttp',{value0:status,value1:text}):text);
  error.status=status;
  error.contextOverflow=(!status||[400,413,422].includes(status)) && (status===413||/context[_\s-]*(length|window|size)|maximum (?:context|model) length|too many tokens|(?:prompt|input|request|sequence).{0,80}(?:too long|exceed|longer than)/i.test(text));
  const match=text.match(/(?:maximum (?:context|model) length(?:\s+(?:is|of))?|context (?:window|limit|size)(?:\s+(?:is|of))?)[:\s(]+([\d,]+)/i)
    || text.match(/(?:max_context_length|context_window|model_max_length)["'\s:=]+([\d,]+)/i);
  const window=Number(match?.[1].replaceAll(',',''));
  if(Number.isSafeInteger(window)&&window>0)error.contextWindow=window;
  return error;
}
function argumentText(value) {
  if(typeof value==='string')return value;
  // Some gateways serialize the SDK's argument union instead of its string value.
  if(value && typeof value==='object' && !Array.isArray(value)) {
    if(typeof value.OfString==='string' && Object.keys(value).every(k=>['OfString','OfResponseToolSearchCallArguments'].includes(k)))return value.OfString;
    return JSON.stringify(value);
  }
  throw new Error(t('errors.theProviderReturnedInvalidToolArguments'));
}
function completeCalls(calls) {
  return calls.map(t=>{
    if(!t.id || !t.function?.name)throw new Error(t('errors.theProviderReturnedAnIncompleteToolCall'));
    const args=argumentText(t.function.arguments);JSON.parse(args);
    return {...t,function:{...t.function,arguments:args}};
  });
}
export async function api(provider, endpoint, init = {}) {
  const response = await fetch(`${provider.baseURL}/${endpoint}`, {
    ...init, redirect:'error',
    headers: { 'Content-Type':'application/json', ...(provider.apiKey ? { Authorization:`Bearer ${provider.apiKey}` } : {}), ...init.headers },
    signal:init.signal || AbortSignal.timeout(60000)
  });
  if (!response.ok) {
    throw providerError(provider,response.status,await response.text());
  }
  return response;
}
export async function models(provider) {
  const data=await (await api(provider,'models')).json();
  const items = data.data || data.models;
  if (!Array.isArray(items)) throw new Error(t('errors.theProviderReturnedAnInvalidModelList'));
  const list=items.map(modelInfo).filter(m=>m.id);
  // lumv exposes the same per-model variants used by its OpenCode integration.
  if(new URL(provider.baseURL).hostname==='lumv.app') {
    try {
      const catalog=await (await api(provider,'opencode/catalog',{signal:AbortSignal.timeout(8000)})).json();
      for(const model of list) {
        const entry=catalog.providers?.lumv?.models?.[model.id];
        if(entry)Object.assign(model,modelInfo({...entry,id:model.id,variants:entry.variants||[]}));
      }
    } catch { /* Optional metadata must not prevent using the provider's model list. */ }
  }
  if(new URL(provider.baseURL).hostname==='openrouter.ai')for(const model of list) {
    if(model.supportsReasoning&&!model.reasoningEfforts)model.reasoningEfforts=['none','minimal','low','medium','high','xhigh'];
  }
  return (await enrichModels(provider,list)).sort((a,b)=>a.name.localeCompare(b.name));
}
export function requestMessages(provider,model,messages) {
  // Reasoning state is provider-specific; never carry it into a different provider.
  const format=reasoningProfile(provider,model).format;
  return messages.map(({_attachment,_checkpoint,reasoning_content,reasoning_details,...message})=>({...message,...(format==='deepseek'&&message.role==='assistant'?{reasoning_content:reasoning_content||''}:{}),...(format==='openrouter'&&reasoning_details?{reasoning_details}:{})}));
}
export async function completion(provider, model, messages, tools, signal, onDelta, effort='xhigh', onUsage=()=>{}) {
  const body={model,messages:requestMessages(provider,model,messages),stream:true,...reasoningOptions(provider,model,effort),...(tools.length?{tools,tool_choice:'auto'}:{})};
  if(!noStreamUsage.has(provider.baseURL))body.stream_options={include_usage:true};
  const send=()=>api(provider,'chat/completions',{method:'POST',signal,body:JSON.stringify(body)});
  let response;
  try {response=await send();}
  catch(error) {
    // Older compatible servers explicitly reject this optional field. Retry only
    // a rejected request, never an interrupted request with an unknown outcome.
    if(!body.stream_options || ![400,422].includes(error.status) || error.contextOverflow || !/stream_options|include_usage/i.test(error.message))throw error;
    noStreamUsage.add(provider.baseURL);delete body.stream_options;response=await send();
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const body=await response.json(); if(body.error) throw providerError(provider,null,JSON.stringify(body.error));
    if(body.usage)onUsage(body.usage);
    const m=body.choices?.[0]?.message; if(!m) throw new Error(t('errors.theProviderResponseContainsNoMessage'));
    if(m.content)onDelta(m.content); return { role:'assistant', content:m.content || null, ...(m.reasoning_content!==undefined?{reasoning_content:m.reasoning_content}:{}),...(m.reasoning_details?{reasoning_details:m.reasoning_details}:{}),...(m.tool_calls?.length?{tool_calls:completeCalls(m.tool_calls)}:{}) };
  }
  const decoder=new TextDecoder(); let pending='', content='', reasoning='', finishReason, done=false, activeCall, dataLines=[]; const calls=new Map(), reasoningDetails=new Map();
  const event = block => {
    const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!data) return; if(data==='[DONE]'){done=true;return;}
    const parsed=JSON.parse(data); if(parsed.error) throw providerError(provider,null,JSON.stringify(parsed.error));
    if(parsed.usage)onUsage(parsed.usage);
    const choice=parsed.choices?.[0]; if(choice?.finish_reason)finishReason=choice.finish_reason;
    const delta=choice?.delta; if(!delta)return;
    if(typeof delta.reasoning_content==='string')reasoning+=delta.reasoning_content;
    for(const detail of delta.reasoning_details||[]) {
      const key=detail.index??detail.id??reasoningDetails.size, previous=reasoningDetails.get(key)||{};
      const combined={...previous,...detail};
      for(const field of ['text','data','signature','summary'])if(typeof previous[field]==='string'&&typeof detail[field]==='string')combined[field]=previous[field]+detail[field];
      reasoningDetails.set(key,combined);
    }
    if(typeof delta.content==='string' && delta.content.length) { content+=delta.content; onDelta(delta.content); }
    for(const t of delta.tool_calls || []) {
      // Some OpenAI-compatible gateways emit complete calls with id but no index.
      // Never merge distinct calls into the same undefined-index slot.
      const key=t.index!==undefined?`index:${t.index}`:t.id?`id:${t.id}`:activeCall;
      if(key===undefined)throw new Error(t('errors.aToolCallFragmentHasNoId'));
      activeCall=key;
      const call=calls.get(key) || { id:'',type:'function',function:{name:'',arguments:''} };
      if(t.id)call.id=t.id; if(t.function?.name)call.function.name+=t.function.name;
      if(t.function?.arguments!==undefined && t.function.arguments!==null)call.function.arguments+=argumentText(t.function.arguments); calls.set(key,call);
    }
  };
  const line=raw=>{
    const value=raw.replace(/\r$/,'');
    if(value===''){if(dataLines.length){event(dataLines.join('\n'));dataLines=[];}}
    else if(value.startsWith('data:'))dataLines.push(value);
  };
  for await (const chunk of response.body) {
    pending+=decoder.decode(chunk,{stream:true});
    let i; while((i=pending.indexOf('\n'))!==-1){line(pending.slice(0,i));pending=pending.slice(i+1);}
  }
  pending+=decoder.decode(); if(pending)line(pending);line('');
  if(!done && !finishReason)throw new Error(t('errors.theModelConnectionWasInterruptedIncompleteTool'));
  if(finishReason==='length')throw new Error(t('errors.theModelResponseReachedItsLimitShorten'));
  const tool_calls=completeCalls([...calls.values()]);
  return {role:'assistant',content:content||null,...(reasoning?{reasoning_content:reasoning}:{}),...(reasoningDetails.size?{reasoning_details:[...reasoningDetails.values()]}:{}),...(tool_calls.length?{tool_calls}:{})};
}

import { t } from '../locales/index.mjs';
import { modelInfo, reasoningOptions, reasoningProfile } from './reasoning.mjs';
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
    const text = (await response.text()).slice(0,1500).replaceAll(provider.apiKey || '\0',t('errors.redacted'));
    const error=new Error(t('errors.providerHttp',{value0:response.status,value1:text}));
    error.status=response.status;error.contextOverflow=[400,413,422].includes(response.status)&&/context[_\s-]*(length|window)|maximum context|too many tokens|prompt.{0,30}(too long|exceed)|input.{0,30}exceed/i.test(text);
    throw error;
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
    const catalog=await (await api(provider,'opencode/catalog')).json();
    for(const model of list) {
      const entry=catalog.providers?.lumv?.models?.[model.id];
      if(entry)Object.assign(model,modelInfo({...entry,id:model.id,variants:entry.variants||[]}));
    }
  }
  if(new URL(provider.baseURL).hostname==='openrouter.ai')for(const model of list) {
    if(model.supportsReasoning&&!model.reasoningEfforts)model.reasoningEfforts=['none','minimal','low','medium','high','xhigh'];
  }
  return list.sort((a,b)=>a.name.localeCompare(b.name));
}
export async function completion(provider, model, messages, tools, signal, onDelta, effort='xhigh') {
  // Reasoning state is provider-specific; never carry it into a different provider.
  const format=reasoningProfile(provider,model).format;
  messages=messages.map(({reasoning_content,reasoning_details,...message})=>({...message,...(format==='deepseek'&&message.role==='assistant'?{reasoning_content:reasoning_content||''}:{}),...(format==='openrouter'&&reasoning_details?{reasoning_details}:{})}));
  const response = await api(provider, 'chat/completions', {
    method:'POST', signal,
    body:JSON.stringify({ model, messages, stream:true, ...reasoningOptions(provider,model,effort), ...(tools.length ? { tools, tool_choice:'auto' } : {}) })
  });
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const body=await response.json(); if(body.error) throw new Error(body.error.message || JSON.stringify(body.error));
    const m=body.choices?.[0]?.message; if(!m) throw new Error(t('errors.theProviderResponseContainsNoMessage'));
    if(m.content)onDelta(m.content); return { role:'assistant', content:m.content || null, ...(m.reasoning_content!==undefined?{reasoning_content:m.reasoning_content}:{}),...(m.reasoning_details?{reasoning_details:m.reasoning_details}:{}),...(m.tool_calls?.length?{tool_calls:completeCalls(m.tool_calls)}:{}) };
  }
  const decoder=new TextDecoder(); let pending='', content='', reasoning='', finishReason, done=false, activeCall, dataLines=[]; const calls=new Map(), reasoningDetails=new Map();
  const event = block => {
    const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!data) return; if(data==='[DONE]'){done=true;return;}
    const parsed=JSON.parse(data); if(parsed.error) throw new Error(parsed.error.message || JSON.stringify(parsed.error));
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

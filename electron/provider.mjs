import { t } from '../locales/index.mjs';
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
    throw new Error(t('errors.providerHttp',{value0:response.status,value1:text}));
  }
  return response;
}
export async function models(provider) {
  const data=await (await api(provider,'models')).json();
  const items = data.data || data.models;
  if (!Array.isArray(items)) throw new Error(t('errors.theProviderReturnedAnInvalidModelList'));
  return items.map(m=>({ id:typeof m==='string'?m:m.id, name: m.name || m.id || m })).filter(m=>m.id).sort((a,b)=>a.name.localeCompare(b.name));
}
export async function completion(provider, model, messages, tools, signal, onDelta) {
  const response = await api(provider, 'chat/completions', {
    method:'POST', signal,
    body:JSON.stringify({ model, messages, stream:true, ...(tools.length ? { tools, tool_choice:'auto' } : {}) })
  });
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const body=await response.json(); if(body.error) throw new Error(body.error.message || JSON.stringify(body.error));
    const m=body.choices?.[0]?.message; if(!m) throw new Error(t('errors.theProviderResponseContainsNoMessage'));
    if(m.content)onDelta(m.content); return { role:'assistant', content:m.content || null, ...(m.tool_calls?.length?{tool_calls:completeCalls(m.tool_calls)}:{}) };
  }
  const decoder=new TextDecoder(); let pending='', content='', finishReason, done=false, activeCall, dataLines=[]; const calls=new Map();
  const event = block => {
    const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!data) return; if(data==='[DONE]'){done=true;return;}
    const parsed=JSON.parse(data); if(parsed.error) throw new Error(parsed.error.message || JSON.stringify(parsed.error));
    const choice=parsed.choices?.[0]; if(choice?.finish_reason)finishReason=choice.finish_reason;
    const delta=choice?.delta; if(!delta)return;
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
  return {role:'assistant',content:content||null,...(tool_calls.length?{tool_calls}:{})};
}

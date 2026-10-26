import { t } from '../locales/index.mjs';
import { modelInfo, reasoningOptions, reasoningProfile } from './reasoning.mjs';
import { enrichModels } from './model-catalog.mjs';
import crypto from 'node:crypto';
import { providerDefinition } from './provider-definitions.mjs';
import { responsesCompletion } from './provider-responses.mjs';
import { appFetch } from './network.mjs';
import { argumentText, toolCallStream } from './tool-call-stream.mjs';
const noStreamUsage=new Set();
const activeCredentials=new WeakMap();
function providerError(provider,status,text) {
  let detail;try{const body=JSON.parse(text);detail=body.error||body;}catch{}
  const code=detail?.code;
  const planError={subscription_sharing_usage_limit_exceeded:'errors.planUsageLimit',subscription_sharing_usage_unavailable:'errors.planUsageUnavailable',
    subscription_sharing_user_unavailable:'errors.planUsageUnavailable',subscription_sharing_user_not_eligible:'errors.planNotEligible',
    chatpass_v2_scope_not_authorized:'errors.oauthPlanPermission',chatpass_v2_invalid_authorization_context:'errors.oauthReconnect'}[code];
  const diagnosticText=text;
  if(planError&&providerDefinition(provider)?.manageUsageURL)text=t(planError);
  else if(typeof detail?.message==='string'&&detail.message.trim())text=detail.message;
  else if(typeof detail==='string'&&detail.trim())text=detail;
  for(const secret of [provider.apiKey,...(activeCredentials.get(provider)||[])])if(secret)text=text.replaceAll(secret,t('errors.redacted'));
  text=text.slice(0,1500);
  const error=new Error(status?t('errors.providerHttp',{value0:status,value1:text}):text);
  error.status=status;
  error.code=code;
  if(planError)error.usageAction=providerDefinition(provider)?.manageUsageURL;
  error.contextOverflow=(!status||[400,413,422].includes(status)) && (status===413||/context[_\s-]*(length|window|size)|maximum (?:context|model) length|too many tokens|(?:prompt|input|request|sequence).{0,80}(?:too long|exceed|longer than)/i.test(diagnosticText));
  const match=diagnosticText.match(/(?:maximum (?:context|model) length(?:\s+(?:is|of))?|context (?:window|limit|size)(?:\s+(?:is|of))?)[:\s(]+([\d,]+)/i)
    || diagnosticText.match(/(?:max_context_length|context_window|model_max_length)["'\s:=]+([\d,]+)/i);
  const window=Number(match?.[1].replaceAll(',',''));
  if(Number.isSafeInteger(window)&&window>0)error.contextWindow=window;
  return error;
}
function completeCalls(calls) {
  const ids=new Set();
  return calls.map(call=>{
    if(!call.id || !call.function?.name || ids.has(call.id))throw new Error(t('errors.theProviderReturnedAnIncompleteToolCall'));
    ids.add(call.id);
    let args;
    try {
      args=argumentText(call.function.arguments);
      const value=JSON.parse(args);
      if(!value || typeof value!=='object' || Array.isArray(value))throw new Error();
    } catch {
      throw Object.assign(new Error(t('errors.theProviderReturnedInvalidToolArguments')),{retryableResponse:true});
    }
    return {...call,function:{...call.function,arguments:args}};
  });
}
function checkResponseLength(reason) {
  if(reason==='length')throw Object.assign(new Error(t('errors.theModelResponseReachedItsLimitShorten')),{retryableResponse:true});
}
export async function api(provider, endpoint, init = {}) {
  if(provider.adapter&&!['openai-compatible','openai-responses'].includes(provider.adapter))throw new Error(t('errors.providerAdapterUnsupported'));
  let token=provider.authorize?await provider.authorize():provider.apiKey;
  const headers=new Headers(init.headers);
  headers.set('Content-Type','application/json');
  if(init.method==='POST'&&!headers.has('Idempotency-Key'))headers.set('Idempotency-Key',crypto.randomUUID());
  const send=()=>{
    if(token)activeCredentials.set(provider,[...new Set([token,...(activeCredentials.get(provider)||[])])].slice(0,2));
    if(token)headers.set('Authorization',`Bearer ${token}`);
    return appFetch(`${provider.baseURL}/${endpoint}`,{...init,headers,redirect:'error',signal:init.signal||AbortSignal.timeout(60000)});
  };
  let response=await send();
  if(response.status===401&&provider.authorize) {
    await response.body?.cancel();token=await provider.authorize(token);response=await send();
  }
  if (!response.ok) {
    throw providerError(provider,response.status,await response.text());
  }
  return response;
}
export async function models(provider) {
  const data=await (await api(provider,'models')).json();
  if(providerDefinition(provider)?.accountCatalog) {
    if(!Array.isArray(data.models))throw new Error(t('errors.theProviderReturnedAnInvalidModelList'));
    return data.models.filter(m=>m.visibility==='list'&&typeof m.slug==='string'&&m.slug).map(m=>modelInfo({...m,id:m.slug,name:m.display_name||m.slug,
      reasoning_efforts:m.supported_reasoning_levels?.map(v=>v.effort)||m.reasoning_efforts||m.supported_reasoning_efforts||[]}));
  }
  const items = data.data || data.models;
  if (!Array.isArray(items)) throw new Error(t('errors.theProviderReturnedAnInvalidModelList'));
  const list=items.map(modelInfo).filter(m=>m.id);
  const metadata=providerDefinition(provider)?.catalog;
  if(metadata) {
    try {
      const catalog=await (await api(provider,metadata.path,{signal:AbortSignal.timeout(8000)})).json();
      const entries=metadata.modelsPath.reduce((value,key)=>value?.[key],catalog);
      for(const model of list) {
        const entry=entries?.[model.id];
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
  return messages.map(({_attachment,_checkpoint,_responseItems,_responseBinding,reasoning_content,reasoning_details,...message})=>({...message,...(format==='deepseek'&&message.role==='assistant'?{reasoning_content:reasoning_content||''}:{}),...(format==='openrouter'&&reasoning_details?{reasoning_details}:{})}));
}
export async function completion(provider, model, messages, tools, signal, onDelta, effort='xhigh', onUsage=()=>{}) {
  if(provider.adapter==='openai-responses')return responsesCompletion(provider,model,messages,tools,signal,onDelta,effort,onUsage,api,providerError);
  const body={model,messages:requestMessages(provider,model,messages),stream:true,...reasoningOptions(provider,model,effort),...(tools.length?{tools,tool_choice:'auto'}:{})};
  if(tools.length && providerDefinition(provider)?.id==='lumv')body.max_tokens=Math.min(16384,provider.models?.find(m=>m.id===model)?.outputWindow||16384);
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
    checkResponseLength(body.choices?.[0]?.finish_reason);
    const m=body.choices?.[0]?.message; if(!m) throw new Error(t('errors.theProviderResponseContainsNoMessage'));
    if(m.content)onDelta(m.content); return { role:'assistant', content:m.content || null, ...(m.reasoning_content!==undefined?{reasoning_content:m.reasoning_content}:{}),...(m.reasoning_details?{reasoning_details:m.reasoning_details}:{}),...(m.tool_calls?.length?{tool_calls:completeCalls(m.tool_calls)}:{}) };
  }
  const decoder=new TextDecoder(); let pending='', content='', reasoning='', finishReason, done=false, dataLines=[]; const calls=toolCallStream(), reasoningDetails=new Map();
  const event = block => {
    const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!data) return; if(data==='[DONE]'){done=true;return;}
    let parsed;
    try{parsed=JSON.parse(data);}catch{throw new Error(t('errors.theModelConnectionWasInterruptedIncompleteTool'));}
    if(parsed.error) throw providerError(provider,null,JSON.stringify(parsed.error));
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
    for(const fragment of delta.tool_calls || [])calls.append(fragment);
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
  checkResponseLength(finishReason);
  const tool_calls=completeCalls([...calls.values()]);
  return {role:'assistant',content:content||null,...(reasoning?{reasoning_content:reasoning}:{}),...(reasoningDetails.size?{reasoning_details:[...reasoningDetails.values()]}:{}),...(tool_calls.length?{tool_calls}:{})};
}

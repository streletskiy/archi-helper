export const EFFORTS = ['none','minimal','low','medium','high','xhigh','max','ultra'];
export const FORMATS = ['auto','effort','openrouter','deepseek','none'];
const values = list => [...new Set((Array.isArray(list) ? list : []).map(v=>typeof v==='string'?v:v?.value||v?.id).filter(v=>EFFORTS.includes(v)))];

export function reasoningProfile(provider, model) {
  const info=provider?.models?.find(m=>m.id===model), host=new URL(provider?.baseURL||'https://unknown.invalid').hostname;
  let format=provider?.reasoningFormat||'auto', efforts;
  if(format==='none')return {format,efforts:[]};
  if(format==='auto')format=host==='openrouter.ai'?'openrouter':host==='api.deepseek.com'?'deepseek':'effort';
  // lumv's DeepSeek adapter explicitly rejects thinking combined with function tools.
  // Archi Helper always sends tools; the general OpenCode catalog includes text-only variants.
  if(host==='lumv.app'&&/deepseek/i.test(model))return {format,efforts:['none'],toolRestricted:true};
  if(provider?.reasoningEfforts?.length)efforts=values(provider.reasoningEfforts);
  else if(Array.isArray(info?.reasoningEfforts))efforts=values(info.reasoningEfforts);
  else {
    const id=String(model).toLowerCase().split('/').pop();
    if(format==='deepseek')efforts=/v4|flash|pro/.test(id)?['none','low','high','max']:[];
    else if(host==='api.openai.com') {
      if(/chat|search|audio|image|realtime/.test(id))efforts=[];
      else if(/^gpt-5-pro(?:-|$)/.test(id))efforts=['high'];
      else if(/^gpt-(5\.[2-9]|6)/.test(id))efforts=['low','medium','high','xhigh',...(/^gpt-6/.test(id)?['max']:[])];
      else if(/^gpt-5/.test(id))efforts=['minimal','low','medium','high'];
      else if(/^o[134](?:-|$)/.test(id)&&!/^o1-(mini|preview)/.test(id))efforts=['low','medium','high'];
    }
    // Unknown compatible endpoints must advertise support or be configured explicitly.
    if(!efforts && provider?.reasoningFormat && provider.reasoningFormat!=='auto')efforts=['low','medium','high','xhigh'];
  }
  return {format,efforts:efforts||[]};
}
export function selectedEffort(efforts, preferred='xhigh') {
  if(efforts.includes(preferred))return preferred;
  const rank=EFFORTS.indexOf(preferred);
  return [...EFFORTS].reverse().find(v=>EFFORTS.indexOf(v)<=rank&&efforts.includes(v))||efforts[0]||'';
}
export function reasoningOptions(provider, model, preferred='xhigh') {
  const {format,efforts}=reasoningProfile(provider,model), effort=selectedEffort(efforts,preferred);
  if(!effort)return {};
  if(format==='openrouter')return {reasoning:{effort}};
  if(format==='deepseek')return effort==='none'?{thinking:{type:'disabled'}}:{thinking:{type:'enabled'},reasoning_effort:effort};
  return {reasoning_effort:effort};
}
export function modelInfo(model) {
  if(typeof model==='string')return {id:model,name:model};
  const advertised=model.reasoning_efforts??model.supported_reasoning_efforts??model.efforts??model.variants??model.fields?.find(f=>f.name==='reasoning_effort')?.options;
  const contextWindow=Number(model.context_window??model.context_length??model.limit?.context??model.top_provider?.context_length);
  return {id:model.id,name:model.name||model.id,...(Array.isArray(advertised)?{reasoningEfforts:values(advertised)}:{}),...(contextWindow>0?{contextWindow}:{}),...(model.supported_parameters?.includes('reasoning')?{supportsReasoning:true}:{})};
}

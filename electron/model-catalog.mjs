import { modelInfo } from './reasoning.mjs';

let pending, refreshedAt=0;
const normalized=id=>String(id).toLowerCase().replace(/[^a-z0-9/]/g,'');
async function catalog() {
  if(!pending || Date.now()-refreshedAt>86400000) {
    refreshedAt=Date.now();
    // Public metadata only: never send provider keys, endpoints or conversation data.
    pending=fetch('https://models.dev/api.json',{redirect:'error',signal:AbortSignal.timeout(8000)})
      .then(response=>{if(!response.ok)throw new Error('Model catalog unavailable');return response.json();})
      .then(data=>data&&typeof data==='object'&&!Array.isArray(data)?data:{})
      .catch(()=>{refreshedAt=Date.now()-86340000;return {};});
  }
  return pending;
}
export async function enrichModels(provider, models) {
  const host=new URL(provider.baseURL).hostname;
  models=models.map(model=>{
    // DeepSeek's /models can omit limits. These documented aliases have a 1M window.
    if(!model.contextWindow && host==='api.deepseek.com' && /^(deepseek-flash|deepseek-v4-pro|deepseek-v4-flash(?:-vision-exp)?)$/i.test(model.id))return {...model,contextWindow:1000000};
    return model;
  });
  if(models.every(m=>m.contextWindow))return models;
  const data=await catalog(), entries=Object.entries(data).filter(([,p])=>p&&typeof p==='object');
  const native=entries.find(([,p])=>{try{return new URL(p.api).hostname===host;}catch{return false;}})?.[1]
    || data[host.replace(/^api\./,'').split('.')[0]];
  const index=list=>{
    const map=new Map();
    for(const m of list)if(m?.id){const key=normalized(m.id);map.set(key,[...(map.get(key)||[]),m]);}
    return map;
  };
  const local=index(Object.values(native?.models||{})), all=index(entries.flatMap(([,p])=>Object.values(p.models||{})));
  return models.map(model=>{
    if(model.contextWindow)return model;
    const id=normalized(model.id);
    let candidates=local.get(id)||all.get(id)||[];
    // Namespaced gateway IDs may refer to a vendor's bare model ID.
    if(!candidates.length && id.includes('/'))candidates=all.get(id.split('/').pop())||[];
    const limits=candidates.map(modelInfo).filter(m=>m.contextWindow);
    if(!limits.length)return model;
    // Gateway-specific advertised limits take precedence above. For aliases without
    // metadata, start with the model's largest catalog window and learn API limits.
    const inferred=limits.reduce((a,b)=>a.contextWindow>=b.contextWindow?a:b);
    return {...model,contextWindow:inferred.contextWindow,...(!model.inputWindow&&inferred.inputWindow?{inputWindow:inferred.inputWindow}:{})};
  });
}

export function estimateTokens(value,imageTokens=4096) {
  let images=0;
  const text=JSON.stringify(value,(_key,item)=>{
    if(item?.type==='image_url'){images+=imageTokens;return {type:'image_url'};}
    return item;
  });
  // UTF-8 bytes account for Cyrillic/CJK; image data is not text/base64 tokens.
  return Math.ceil(Buffer.byteLength(text||'','utf8')/3)+images+8;
}

export function modelOutputLimit(provider,model,messages=[],tools=[]) {
  const info=provider.models?.find(item=>item.id===model);
  const output=Number(info?.outputWindow),context=Number(info?.contextWindow);
  // An unknown output limit is not the context window. Keep the provider default
  // until metadata is available instead of guessing a universal model limit.
  if(!Number.isSafeInteger(output)||output<=0)return undefined;
  if(!Number.isSafeInteger(context)||context<=0)return output;
  const input=estimateTokens(messages,provider.supportsImages?4096:0)+estimateTokens(tools);
  return Math.min(output,Math.max(1,Math.floor(context*.95)-input));
}

export function modelResponseTimeout(provider,model) {
  const output=provider.models?.find(item=>item.id===model)?.outputWindow;
  // Match the long-response windows supported by the gateway. Cancellation and
  // user corrections still interrupt waiting immediately.
  return output>128000?2*60*60_000:10*60_000;
}

import { t } from '../locales/index.mjs';

export function oauthDefinition(id, definitions) {
  const definition=definitions.find(value=>value.id===id);
  if(!definition?.oauth)throw new Error(t('errors.oauthUnsupported'));
  const config=definition.oauth;
  for(const value of [definition.baseURL,config.authorizationURL,config.tokenURL,config.revocationURL,config.profileURL,config.resource,config.oidc?.issuer,config.oidc?.jwksURL].filter(Boolean)) {
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search)throw new Error(t('errors.oauthConfiguration'));
  }
  if(!config.clientId||!Array.isArray(config.scopes)||!config.scopes.length||!/^\/[a-zA-Z0-9/_-]+$/.test(config.redirectPath))throw new Error(t('errors.oauthConfiguration'));
  return definition;
}

export function tokenResponse(body, previous) {
  if(!body||body.token_type?.toLowerCase()!=='bearer'||typeof body.access_token!=='string'||
    !/^[\x21-\x7e]{1,8192}$/.test(body.access_token)||!Number.isFinite(body.expires_in)||body.expires_in<=0||body.expires_in>366*86400)
    throw new Error(t('errors.oauthInvalidResponse'));
  const refreshToken=body.refresh_token??previous?.refreshToken;
  if(typeof refreshToken!=='string'||!/^[\x21-\x7e]{1,8192}$/.test(refreshToken))throw new Error(t('errors.oauthInvalidResponse'));
  if(body.id_token!==undefined&&(typeof body.id_token!=='string'||! /^[\x21-\x7e]{1,32768}$/.test(body.id_token)))throw new Error(t('errors.oauthInvalidResponse'));
  if(body.scope!==undefined&&(typeof body.scope!=='string'||body.scope.length>8192))throw new Error(t('errors.oauthInvalidResponse'));
  return {accessToken:body.access_token,refreshToken,expiresAt:Date.now()+body.expires_in*1000,
    ...(body.earliest_refresh_at!==undefined?{earliestRefreshAt:body.earliest_refresh_at}:{}),
    ...(body.id_token?{idToken:body.id_token}:previous?.idToken?{idToken:previous.idToken}:{}),
    scopes:body.scope!==undefined?body.scope.split(/\s+/).filter(Boolean):previous?.scopes||[]};
}

export async function oauthPost(url, values, fetcher=fetch) {
  let response;
  try { response=await fetcher(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams(values).toString(),signal:AbortSignal.timeout(20000)}); }
  catch { throw new Error(t('errors.oauthNetwork')); }
  const body=await response.json().catch(()=>null);
  if(!response.ok) {
    const received=typeof body?.error==='string'?body.error:body?.error?.code||body?.code;
    const code=typeof received==='string'&&/^[a-zA-Z0-9_.-]{1,128}$/.test(received)?received:'server_error';
    let detail=body?.error_description||body?.error?.message||body?.detail||'';
    if(typeof detail!=='string')detail='';
    for(const key of ['code','code_verifier','refresh_token','token','access_token','id_token']) {
      for(const secret of [values[key],body?.[key]])if(typeof secret==='string'&&secret)detail=detail.replaceAll(secret,t('errors.redacted'));
    }
    detail=detail.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,500);
    const requestId=response.headers.get('x-request-id')||response.headers.get('request-id')||response.headers.get('cf-ray');
    if(code==='unsupported_country_region_territory')detail=t('errors.oauthRegionUnsupported');
    const error=new Error(code==='invalid_grant'?t('errors.oauthReconnect'):t('errors.oauthProviderFailure',{status:response.status,code,detail}));
    error.oauthCode=code;error.requestId=requestId?.slice(0,150);
    error.status=response.status;error.definitive=typeof received==='string';
    throw error;
  }
  return body;
}

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
    const error=new Error(t(body?.error==='invalid_grant'?'errors.oauthReconnect':'errors.oauthFailed'));
    error.oauthCode=typeof body?.error==='string'?body.error:'server_error';
    error.status=response.status;error.definitive=typeof body?.error==='string';
    throw error;
  }
  return body;
}

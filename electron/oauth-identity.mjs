import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { t } from '../locales/index.mjs';

export function identityVerifier(fetcher=fetch) {
  const keys=new Map();
  return async(config,idToken,clientId,nonce,subject)=>{
    try {
      if(!idToken)throw new Error('Missing ID token');
      const {issuer,jwksURL}=config.oidc;
      if(!keys.has(jwksURL))keys.set(jwksURL,createRemoteJWKSet(new URL(jwksURL),{
        [customFetch]:(url,init)=>fetcher(url.toString(),{...init,redirect:'error'})}));
      const {payload}=await jwtVerify(idToken,keys.get(jwksURL),{issuer,audience:clientId,algorithms:['RS256'],
        requiredClaims:['exp','iat','sub'],clockTolerance:5});
      if(typeof payload.sub!=='string'||!payload.sub||payload.sub.length>256||
        (nonce!==undefined&&payload.nonce!==nonce)||(subject&&payload.sub!==subject))throw new Error('Identity mismatch');
      return {id:payload.sub,name:String(payload.email||payload.name||payload.sub).slice(0,200)};
    } catch {throw new Error(t('errors.oauthIdentityInvalid'));}
  };
}

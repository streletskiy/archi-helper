import crypto from 'node:crypto';
import { t } from '../locales/index.mjs';
import { providerDefinitions } from './provider-definitions.mjs';
import { oauthDefinition,oauthPost,tokenResponse } from './oauth-config.mjs';
import { loopbackAuthorization } from './oauth-loopback.mjs';
import { readOAuthTokens,saveOAuthProvider,saveOAuthRegistration,archiveOAuthRegistration,updateOAuthTokens } from './oauth-store.mjs';
import { identityVerifier } from './oauth-identity.mjs';
import { providerFetch } from './provider-network.mjs';

export class OAuthManager {
  constructor(store,{openExternal,fetcher=providerFetch,definitions=providerDefinitions,authorize=loopbackAuthorization}={}) {
    Object.assign(this,{store,openExternal,fetcher,definitions,authorize});this.refreshing=new Map();this.disconnecting=new Set();
    this.verifyIdentity=identityVerifier(fetcher);this.retryAfter=new Map();
  }
  provider(id) {
    const provider=this.store.state.providers.find(p=>p.id===id),definition=oauthDefinition(provider?.definitionId,this.definitions);
    if(provider?.baseURL!==definition.baseURL)throw new Error(t('errors.oauthEndpointLocked'));
    return {provider,definition};
  }
  async connect(definitionId,id,registrationId) {
    if(this.pending||this.disconnecting.size||this.refreshing.size)throw new Error(t('errors.oauthAlreadyConnecting'));
    const definition=oauthDefinition(definitionId,this.definitions),config={...definition.oauth};
    if(id&&!this.store.state.providers.some(p=>p.id===id))throw new Error(t('errors.providerNotFound'));
    const registrations=(this.store.state.oauthRegistrations||[]).filter(p=>p.definitionId===definitionId);
    const registration=!id&&config.retainRegistration&&registrationId!==null?
      (registrationId?registrations.find(p=>p.id===registrationId):registrations.at(-1)):undefined;
    if(registrationId&&!registration)throw new Error(t('errors.providerNotFound'));
    const selected=id?this.store.state.providers.find(p=>p.id===id):registration;
    if(selected&&(!selected.oauth||selected.definitionId!==definitionId))throw new Error(t('errors.oauthEndpointLocked'));
    if(selected?.oauth.status==='revoking')throw new Error(t('errors.oauthRevokeFailed'));
    if(config.dynamicRegistration) {
      config.newRegistration=!selected?.oauth.clientId;
      config.clientId=selected?.oauth.clientId||config.clientId;
      if(selected?.oauth.planEnabled===false)config.authorizationParameters={prompt:'consent'};
      if(selected?.encryptedOAuth) {
        const previous=readOAuthTokens(this.store,selected);
        if(previous.idToken)config.authorizationParameters={...config.authorizationParameters,id_token_hint:previous.idToken};
      }
    }
    const controller=new AbortController();this.pending=controller;
    let tokens,persisted=false;
    try {
      this.store.state.installationId||=crypto.randomUUID();await this.store.save();
      const {code,verifier,redirectUri,nonce,clientId}=await this.authorize(config,{openExternal:this.openExternal,
        installationId:this.store.state.installationId,signal:controller.signal});
      controller.signal.throwIfAborted();
      if(config.oidc&&(typeof nonce!=='string'||nonce.length<32))throw new Error(t('errors.oauthInvalidResponse'));
      if(config.dynamicRegistration) {
        if(typeof clientId!=='string'||!/^[a-zA-Z0-9_-]{1,256}$/.test(clientId)||clientId===definition.oauth.clientId||(!config.newRegistration&&clientId!==config.clientId))throw new Error(t('errors.oauthInvalidResponse'));
        config.clientId=clientId;
        if(!id)id=await saveOAuthRegistration(this.store,definition,clientId,registration);
      }
      const body=await oauthPost(config.tokenURL,{grant_type:'authorization_code',client_id:config.clientId,
        code,code_verifier:verifier,redirect_uri:redirectUri,...(config.resource?{resource:config.resource}:{})},this.fetcher);
      tokens=tokenResponse(body);
      const profile=config.oidc?await this.verifyIdentity(config,tokens.idToken,config.clientId,nonce,selected?.oauth.accountId):await this.profile(config,tokens.accessToken);
      const old=id&&this.store.state.providers.find(p=>p.id===id);
      if(old?.oauth?.accountId&&old.oauth.accountId!==profile.id)throw new Error(t('errors.oauthAccountMismatch'));
      controller.signal.throwIfAborted();
      const existing=id||(!config.dynamicRegistration&&this.store.state.providers.find(p=>p.definitionId===definitionId&&p.oauth?.accountId===profile.id)?.id);
      const providerId=await saveOAuthProvider(this.store,definition,tokens,profile,existing);persisted=true;
      return providerId;
    } finally {
      if(tokens&&!persisted)await this.revoke(config,tokens.refreshToken).catch(()=>{});
      if(this.pending===controller)this.pending=null;
    }
  }
  async profile(config,token) {
    if(!config.profileURL)return {};
    const response=await this.fetcher(config.profileURL,{redirect:'error',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error(t('errors.oauthInvalidResponse'));
    const data=await response.json(),fields=config.profileFields||{id:'id',name:'name'};
    if(typeof data[fields.id]!=='string'||!data[fields.id])throw new Error(t('errors.oauthInvalidResponse'));
    return {id:data[fields.id].slice(0,200),name:String(data[fields.name]||'').slice(0,200)};
  }
  async access(id,rejectedToken) {
    if(this.pending||this.disconnecting.has(id))throw new Error(t('errors.oauthReconnect'));
    const {provider}=this.provider(id);
    if(provider.oauth.status!=='connected')throw new Error(t('errors.oauthReconnect'));
    if(provider.oauth.planEnabled===false)throw new Error(t('errors.oauthPlanPermission'));
    if((this.retryAfter.get(id)||0)>Date.now())throw new Error(t('errors.oauthTemporarilyUnavailable'));
    if(this.refreshing.has(id))return this.refreshing.get(id);
    const tokens=readOAuthTokens(this.store,provider);
    if(tokens.expiresAt>Date.now()+60000&&(!rejectedToken||tokens.accessToken!==rejectedToken))return tokens.accessToken;
    const pending=this.refresh(id,provider.oauth.connectionId,tokens);
    this.refreshing.set(id,pending);
    try {return await pending;}finally{if(this.refreshing.get(id)===pending)this.refreshing.delete(id);}
  }
  async refresh(id,connectionId,previous) {
    const {definition,provider}=this.provider(id),config={...definition.oauth,clientId:provider.oauth.clientId||definition.oauth.clientId};
    try {
      const body=await oauthPost(config.tokenURL,{grant_type:'refresh_token',client_id:config.clientId,
        refresh_token:previous.refreshToken,...(config.resource?{resource:config.resource}:{})},this.fetcher);
      const tokens=tokenResponse(body,previous);
      if(config.oidc&&body.id_token)await this.verifyIdentity(config,body.id_token,config.clientId,undefined,provider.oauth.accountId);
      await updateOAuthTokens(this.store,id,connectionId,tokens);
      if(config.planScope&&!tokens.scopes.includes(config.planScope)) {
        provider.oauth.planEnabled=false;await this.store.save();throw new Error(t('errors.oauthPlanPermission'));
      }
      return tokens.accessToken;
    } catch(error) {
      // A lost refresh response has an unknown outcome. Never blindly replay its consumed token.
      const provider=this.store.state.providers.find(p=>p.id===id);
      if(provider?.oauth?.connectionId===connectionId) {
        if(error.definitive&&['temporarily_unavailable','server_error'].includes(error.oauthCode))this.retryAfter.set(id,Date.now()+10000);
        else {
          provider.oauth.status='reauthorize';
          if(config.retainRegistration&&['invalid_grant','invalid_refresh_token','token_expired','refresh_token_expired','refresh_token_invalidated','refresh_token_reused'].includes(error.oauthCode))delete provider.encryptedOAuth;
          await this.store.save();
        }
      }
      throw error;
    }
  }
  async revoke(config,token) {
    if(!config.revocationURL)throw new Error(t('errors.oauthRevocationUnavailable'));
    const response=await this.fetcher(config.revocationURL,{method:'POST',redirect:'error',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:config.clientId,token,token_type_hint:'refresh_token'}).toString(),signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error(t('errors.oauthRevokeFailed'));
  }
  async disconnect(id) {
    if(this.pending||this.disconnecting.has(id))throw new Error(t('errors.oauthAlreadyConnecting'));
    this.disconnecting.add(id);
    try {
      await this.refreshing.get(id)?.catch(()=>{});
      const {provider,definition}=this.provider(id);
      const tokens=provider.encryptedOAuth?readOAuthTokens(this.store,provider):null;
      provider.oauth.status='revoking';await this.store.save();
      try {if(tokens)await this.revoke({...definition.oauth,clientId:provider.oauth.clientId||definition.oauth.clientId},tokens.refreshToken);}catch{throw new Error(t('errors.oauthRevokeFailed'));}
      if(definition.oauth.retainRegistration) {
        await archiveOAuthRegistration(this.store,provider);
      } else await this.store.deleteProvider(id);
    } finally {this.disconnecting.delete(id);}
  }
  cancel() {this.pending?.abort();}
  dispose() {this.cancel();}
}

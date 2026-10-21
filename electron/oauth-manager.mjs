import crypto from 'node:crypto';
import { t } from '../locales/index.mjs';
import { providerDefinitions } from './provider-definitions.mjs';
import { oauthDefinition,oauthPost,tokenResponse } from './oauth-config.mjs';
import { loopbackAuthorization } from './oauth-loopback.mjs';
import { readOAuthTokens,saveOAuthProvider,updateOAuthTokens } from './oauth-store.mjs';

export class OAuthManager {
  constructor(store,{openExternal,fetcher=fetch,definitions=providerDefinitions,authorize=loopbackAuthorization}={}) {
    Object.assign(this,{store,openExternal,fetcher,definitions,authorize});this.refreshing=new Map();this.disconnecting=new Set();
  }
  provider(id) {
    const provider=this.store.state.providers.find(p=>p.id===id),definition=oauthDefinition(provider?.definitionId,this.definitions);
    if(provider.baseURL!==definition.baseURL)throw new Error(t('errors.oauthEndpointLocked'));
    return {provider,definition};
  }
  async connect(definitionId,id) {
    if(this.pending)throw new Error(t('errors.oauthAlreadyConnecting'));
    const definition=oauthDefinition(definitionId,this.definitions),config=definition.oauth;
    if(id&&!this.store.state.providers.some(p=>p.id===id))throw new Error(t('errors.providerNotFound'));
    const controller=new AbortController();this.pending=controller;
    let tokens,persisted=false;
    try {
      this.store.state.installationId||=crypto.randomUUID();await this.store.save();
      const {code,verifier,redirectUri}=await this.authorize(config,{openExternal:this.openExternal,
        installationId:this.store.state.installationId,signal:controller.signal});
      controller.signal.throwIfAborted();
      tokens=tokenResponse(await oauthPost(config.tokenURL,{grant_type:'authorization_code',client_id:config.clientId,
        code,code_verifier:verifier,redirect_uri:redirectUri},this.fetcher));
      const profile=await this.profile(config,tokens.accessToken);
      const old=id&&this.store.state.providers.find(p=>p.id===id);
      if(old?.oauth?.accountId&&old.oauth.accountId!==profile.id)throw new Error(t('errors.oauthAccountMismatch'));
      controller.signal.throwIfAborted();
      const existing=id||this.store.state.providers.find(p=>p.definitionId===definitionId&&p.oauth?.accountId===profile.id)?.id;
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
    if(this.disconnecting.has(id))throw new Error(t('errors.oauthReconnect'));
    const {provider}=this.provider(id);
    if(provider.oauth.status!=='connected')throw new Error(t('errors.oauthReconnect'));
    if(this.refreshing.has(id))return this.refreshing.get(id);
    const tokens=readOAuthTokens(this.store,provider);
    if(tokens.expiresAt>Date.now()+60000&&(!rejectedToken||tokens.accessToken!==rejectedToken))return tokens.accessToken;
    const pending=this.refresh(id,provider.oauth.connectionId,tokens);
    this.refreshing.set(id,pending);
    try {return await pending;}finally{if(this.refreshing.get(id)===pending)this.refreshing.delete(id);}
  }
  async refresh(id,connectionId,previous) {
    const {definition}=this.provider(id),config=definition.oauth;
    try {
      const tokens=tokenResponse(await oauthPost(config.tokenURL,{grant_type:'refresh_token',client_id:config.clientId,
        refresh_token:previous.refreshToken},this.fetcher),previous);
      await updateOAuthTokens(this.store,id,connectionId,tokens);
      return tokens.accessToken;
    } catch(error) {
      // A lost refresh response has an unknown outcome. Never blindly replay its consumed token.
      const provider=this.store.state.providers.find(p=>p.id===id);
      if(provider?.oauth?.connectionId===connectionId){provider.oauth.status='reauthorize';await this.store.save();}
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
    this.disconnecting.add(id);
    try {
      await this.refreshing.get(id)?.catch(()=>{});
      const {provider,definition}=this.provider(id);
      const tokens=readOAuthTokens(this.store,provider);
      provider.oauth.status='revoking';await this.store.save();
      try {await this.revoke(definition.oauth,tokens.refreshToken);}catch{throw new Error(t('errors.oauthRevokeFailed'));}
      await this.store.deleteProvider(id);
    } finally {this.disconnecting.delete(id);}
  }
  cancel() {this.pending?.abort();}
  dispose() {this.cancel();}
}

import crypto from 'node:crypto';
import { t } from '../locales/index.mjs';

export async function saveOAuthProvider(store,definition,tokens,profile,id) {
  const old=store.state.providers.find(p=>p.id===id);
  if(old?.oauth&&old.definitionId!==definition.id)throw new Error(t('errors.oauthEndpointLocked'));
  const provider={...(old||{}),id:old?.id||crypto.randomUUID(),name:definition.name,baseURL:definition.baseURL,
    definitionId:definition.id,adapter:definition.adapter,models:old?.baseURL===definition.baseURL?old.models:[],
    model:old?.baseURL===definition.baseURL?old.model:'',supportsImages:definition.supportsImages===true,
    encryptedOAuth:store.secrets.encrypt(JSON.stringify(tokens)),
    oauth:{connectionId:crypto.randomUUID(),status:'connected',accountId:profile?.id||'',accountName:profile?.name||definition.name}};
  delete provider.encryptedKey;
  const previous={...store.state};
  store.state.providers=[...store.state.providers.filter(p=>p.id!==provider.id),provider];
  store.state.providerId||=provider.id;
  try {await store.save();}catch(error){store.state=previous;throw error;}
  return provider.id;
}

export function readOAuthTokens(store,provider) {
  if(!provider?.encryptedOAuth)throw new Error(t('errors.oauthReconnect'));
  return JSON.parse(store.secrets.decrypt(provider.encryptedOAuth));
}

export async function updateOAuthTokens(store,id,connectionId,tokens) {
  const provider=store.state.providers.find(p=>p.id===id);
  if(provider?.oauth?.connectionId!==connectionId)throw new Error(t('errors.oauthReconnect'));
  const previous=provider.encryptedOAuth;
  provider.encryptedOAuth=store.secrets.encrypt(JSON.stringify(tokens));
  try {await store.save();}catch(error){provider.encryptedOAuth=previous;throw error;}
}

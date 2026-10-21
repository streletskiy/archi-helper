import crypto from 'node:crypto';
import { t } from '../locales/index.mjs';

export async function saveOAuthProvider(store,definition,tokens,profile,id) {
  const old=store.state.providers.find(p=>p.id===id);
  if(old?.oauth&&old.definitionId!==definition.id)throw new Error(t('errors.oauthEndpointLocked'));
  const provider={...(old||{}),id:old?.id||crypto.randomUUID(),name:definition.name,baseURL:definition.baseURL,
    definitionId:definition.id,adapter:definition.adapter,models:old?.baseURL===definition.baseURL?old.models:[],
    model:old?.baseURL===definition.baseURL?old.model:'',supportsImages:definition.supportsImages===true,
    encryptedOAuth:store.secrets.encrypt(JSON.stringify(tokens)),
    oauth:{connectionId:crypto.randomUUID(),status:'connected',accountId:profile?.id||'',accountName:profile?.name||definition.name,
      ...(old?.oauth?.clientId?{clientId:old.oauth.clientId}:{}),
      ...(definition.oauth.planScope?{planEnabled:tokens.scopes.includes(definition.oauth.planScope)}:{})}};
  if(definition.accountCatalog){provider.models=[];provider.model='';delete provider.catalogUpdatedAt;}
  delete provider.encryptedKey;
  const previous={...store.state};
  store.state.providers=[...store.state.providers.filter(p=>p.id!==provider.id),provider];
  store.state.providerId||=provider.id;
  if(store.state.providerId===provider.id&&definition.accountCatalog)store.state.model='';
  try {await store.save();}catch(error){store.state=previous;throw error;}
  return provider.id;
}

// Persist the issued registration before exchanging a one-use code. A failed exchange
// or later logout must reuse this client rather than silently creating another grant.
export async function saveOAuthRegistration(store,definition,clientId) {
  const provider={id:crypto.randomUUID(),name:definition.name,baseURL:definition.baseURL,definitionId:definition.id,
    adapter:definition.adapter,supportsImages:definition.supportsImages===true,models:[],model:'',
    oauth:{clientId,status:'reauthorize',accountId:'',accountName:definition.name}};
  store.state.providers.push(provider);
  try {await store.save();}catch(error){store.state.providers=store.state.providers.filter(p=>p!==provider);throw error;}
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

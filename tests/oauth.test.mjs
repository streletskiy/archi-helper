import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Store } from '../electron/store.mjs';
import { OAuthManager } from '../electron/oauth-manager.mjs';
import { loopbackAuthorization } from '../electron/oauth-loopback.mjs';
import { oauthDefinition,tokenResponse } from '../electron/oauth-config.mjs';
import { readOAuthTokens } from '../electron/oauth-store.mjs';
import { api } from '../electron/provider.mjs';

const definition={id:'test-provider',name:'Test Provider',baseURL:'https://provider.example/v1',adapter:'openai-compatible',
  oauth:{clientId:'registered-public-client',authorizationURL:'https://identity.example/authorize',
    tokenURL:'https://identity.example/token',revocationURL:'https://identity.example/revoke',
    profileURL:'https://identity.example/me',scopes:['models:read','offline_access'],redirectPath:'/oauth/callback'}};

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'archi-oauth-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=new Store(root,{encrypt:text=>Buffer.from(text).toString('base64'),decrypt:text=>Buffer.from(text,'base64').toString()});
  await store.init('en');
  let serial=0,refreshes=0,revokeFails=false;
  const fetcher=async(url,init)=>{
    if(url.endsWith('/me'))return Response.json({id:'account-123',name:'Example User'});
    if(url.endsWith('/revoke'))return new Response(null,{status:revokeFails?503:200});
    assert.equal(url,definition.oauth.tokenURL);
    const input=new URLSearchParams(init.body);
    if(input.get('grant_type')==='refresh_token'){refreshes++;await new Promise(resolve=>setTimeout(resolve,15));}
    serial++;
    return Response.json({access_token:`access-${serial}`,refresh_token:`refresh-${serial}`,token_type:'Bearer',expires_in:3600});
  };
  const manager=new OAuthManager(store,{definitions:[definition],fetcher,
    authorize:async()=>({code:'code',verifier:'verifier',redirectUri:'http://127.0.0.1:55555/oauth/callback'})});
  store.oauthManager=manager;
  return {store,manager,refreshes:()=>refreshes,setRevokeFails:value=>{revokeFails=value;}};
}

test('generic provider connects, persists encrypted credentials and never exposes tokens through public state',async t=>{
  const {store,manager}=await fixture(t),id=await manager.connect(definition.id);
  const provider=store.state.providers.find(p=>p.id===id);
  assert.equal(provider.oauth.accountName,'Example User');
  assert.equal(await manager.access(id),'access-1');
  const publicState=JSON.stringify(store.publicState());
  assert.ok(!publicState.includes('access-1'));assert.ok(!publicState.includes('refresh-1'));
  assert.ok(!publicState.includes('encryptedOAuth'));assert.ok(!publicState.includes(provider.encryptedOAuth));
  const disk=await fs.readFile(store.file,'utf8');assert.ok(!disk.includes('refresh-1'));
  const restarted=new Store(store.directory,store.secrets);await restarted.init('en');
  assert.equal(readOAuthTokens(restarted,restarted.state.providers[0]).refreshToken,'refresh-1');
  await assert.rejects(store.provider({id,name:'Changed',baseURL:'https://evil.example/v1'}),/Disconnect/);
  assert.equal(store.state.providers[0].baseURL,definition.baseURL);
});

test('concurrent expiration refreshes once and updates existing provider snapshots',async t=>{
  const {store,manager,refreshes}=await fixture(t),id=await manager.connect(definition.id),snapshot=store.getProvider(id);
  const provider=store.state.providers[0],tokens=readOAuthTokens(store,provider);
  tokens.expiresAt=0;provider.encryptedOAuth=store.secrets.encrypt(JSON.stringify(tokens));
  assert.deepEqual(await Promise.all(Array.from({length:12},()=>snapshot.authorize())),Array(12).fill('access-2'));
  assert.equal(refreshes(),1);
  assert.equal(await snapshot.authorize('access-1'),'access-2');assert.equal(refreshes(),1);
  assert.equal(readOAuthTokens(store,provider).refreshToken,'refresh-2');
});

test('disconnect confirms server revocation; network failure keeps recovery credentials and disables requests',async t=>{
  const {store,manager,setRevokeFails}=await fixture(t),id=await manager.connect(definition.id);
  setRevokeFails(true);await assert.rejects(manager.disconnect(id),/revocation/);
  assert.equal(store.state.providers.length,1);
  await assert.rejects(manager.access(id),/Reconnect/);
  assert.ok(store.state.providers[0].encryptedOAuth);
  setRevokeFails(false);await manager.disconnect(id);assert.equal(store.state.providers.length,0);
});

test('an unknown refresh result is never blindly replayed',async t=>{
  const {store,manager}=await fixture(t),id=await manager.connect(definition.id);
  manager.fetcher=async()=>{throw new Error('lost response');};
  await assert.rejects(manager.access(id,'access-1'),/response/);
  await assert.rejects(manager.access(id),/Reconnect/);
  assert.equal(store.state.providers[0].oauth.status,'reauthorize');
});

test('manual keys remain supported and cannot follow an edited API address',async t=>{
  const {store}=await fixture(t);
  await store.provider({name:'Manual',baseURL:'https://manual.example/v1',apiKey:'manual-secret'});
  const id=store.state.providers[0].id;
  assert.equal(store.getProvider(id).apiKey,'manual-secret');
  await assert.rejects(store.provider({id,name:'Other',baseURL:'https://other.example/v1'}),/API key/);
  assert.equal(store.state.providers[0].baseURL,'https://manual.example/v1');
});

test('loopback validates state, origin and PKCE and handles cancellation',async()=>{
  const result=await loopbackAuthorization(definition.oauth,{installationId:'test-installation',openExternal:async link=>{
    const url=new URL(link),callback=url.searchParams.get('redirect_uri');
    assert.equal(url.searchParams.get('code_challenge_method'),'S256');
    const spoof=new URL(callback);spoof.searchParams.set('state','ü'.repeat(43));spoof.searchParams.set('code','bad');
    assert.equal((await fetch(spoof)).status,400);
    const valid=new URL(callback);valid.searchParams.set('state',url.searchParams.get('state'));valid.searchParams.set('code','accepted');
    assert.equal((await fetch(valid)).status,200);
    resultChallenge=url.searchParams.get('code_challenge');
  }});
  assert.equal(result.code,'accepted');assert.equal(crypto.createHash('sha256').update(result.verifier).digest('base64url'),resultChallenge);
  const controller=new AbortController();controller.abort();
  await assert.rejects(loopbackAuthorization(definition.oauth,{signal:controller.signal,openExternal:async()=>assert.fail('browser must not open')}),/cancelled/);
});
let resultChallenge;

test('401 retries once with the same idempotency key; uncertain POST outcomes are not retried',async t=>{
  const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
  let calls=0,refreshes=0;const sent=[];
  globalThis.fetch=async(_url,init)=>{sent.push(new Headers(init.headers));calls++;return calls===1?new Response('',{status:401}):Response.json({ok:true});};
  const provider={baseURL:'https://provider.example/v1',authorize:async rejected=>{if(rejected)refreshes++;return rejected?'new-token':'old-token';}};
  assert.equal((await api(provider,'chat/completions',{method:'POST',body:'{}'})).status,200);
  assert.equal(refreshes,1);assert.equal(sent[0].get('Idempotency-Key'),sent[1].get('Idempotency-Key'));
  assert.equal(sent[1].get('Authorization'),'Bearer new-token');
  calls=0;globalThis.fetch=async()=>{calls++;throw new Error('outcome unknown');};
  await assert.rejects(api(provider,'chat/completions',{method:'POST',body:'{}'}));assert.equal(calls,1);
});

test('provider definitions and token responses fail closed',()=>{
  assert.equal(oauthDefinition(definition.id,[definition]).name,definition.name);
  assert.throws(()=>oauthDefinition('missing',[definition]));
  assert.throws(()=>oauthDefinition(definition.id,[{...definition,baseURL:'http://evil.test'}]));
  assert.throws(()=>tokenResponse({access_token:'secret',token_type:'Bearer',expires_in:3600}));
  assert.throws(()=>tokenResponse({access_token:'secret\nheader',refresh_token:'refresh',token_type:'Bearer',expires_in:3600}));
});

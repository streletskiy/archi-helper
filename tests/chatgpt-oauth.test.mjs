import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { Store } from '../electron/store.mjs';
import { OAuthManager } from '../electron/oauth-manager.mjs';
import { loopbackAuthorization } from '../electron/oauth-loopback.mjs';
import { readOAuthTokens } from '../electron/oauth-store.mjs';
import { providerDefinitions } from '../electron/provider-definitions.mjs';

const definition=providerDefinitions.find(p=>p.id==='chatgpt'),nonce='n'.repeat(43);
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'archi-chatgpt-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=new Store(root,{encrypt:value=>Buffer.from(value).toString('base64'),decrypt:value=>Buffer.from(value,'base64').toString()});await store.init('en');
  const {publicKey,privateKey}=await generateKeyPair('RS256'),jwk={...await exportJWK(publicKey),kid:'test-key',alg:'RS256'};
  const state={serial:0,client:0,subject:'subject-1',scopes:definition.oauth.scopes.join(' '),badNonce:false,badAudience:false,badIssuer:false,expired:false,tokenError:'',revocationFails:false,requests:[],authorizations:[]};
  const fetcher=async(url,init)=>{
    if(url===definition.oauth.oidc.jwksURL)return Response.json({keys:[jwk]});
    const body=new URLSearchParams(init.body);state.requests.push({url,body});
    if(url===definition.oauth.revocationURL)return new Response(null,{status:state.revocationFails?503:200});
    assert.equal(body.get('resource'),definition.oauth.resource);assert.notEqual(body.get('client_id'),'dynamic_agent_client');
    if(state.tokenError)return Response.json({error:state.tokenError},{status:400});
    let idToken=await new SignJWT({nonce:state.badNonce?'bad':nonce,email:'same@example.test'}).setProtectedHeader({alg:'RS256',kid:'test-key'})
      .setIssuer(state.badIssuer?'https://wrong.example':definition.oauth.oidc.issuer).setAudience(state.badAudience?'wrong-client':body.get('client_id'))
      .setSubject(state.subject).setIssuedAt().setExpirationTime(state.expired?'1 minute ago':'1h').sign(privateKey);
    if(state.badSignature){const parts=idToken.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);idToken=parts.join('.');}
    state.serial++;
    return Response.json({access_token:`access-${state.serial}`,refresh_token:`refresh-${state.serial}`,id_token:idToken,scope:state.scopes,expires_in:3600,token_type:'Bearer'});
  };
  const manager=new OAuthManager(store,{fetcher,authorize:async config=>{
    state.authorizations.push(config);
    return {code:'one-use',verifier:'verifier',redirectUri:'http://127.0.0.1:54321/auth/callback',nonce,
      clientId:config.newRegistration?`oaiapp_${++state.client}`:config.clientId};
  }});store.oauthManager=manager;return {store,manager,state};
}

test('dynamic registration, verified identity, refresh and logout retain a reusable registration',async t=>{
  const {store,manager,state}=await fixture(t),id=await manager.connect('chatgpt'),host=store.state.installationId;
  const provider=store.state.providers[0];assert.equal(provider.oauth.clientId,'oaiapp_1');assert.equal(provider.oauth.planEnabled,true);
  assert.equal(provider.oauth.accountId,'subject-1');assert.equal(provider.oauth.accountName,'same@example.test');
  const publicText=JSON.stringify(store.publicState());assert.ok(!publicText.includes('access-1'));assert.ok(!publicText.includes('idToken'));
  assert.deepEqual(await Promise.all(Array.from({length:8},()=>manager.access(id,'access-1'))),Array(8).fill('access-2'));
  assert.equal(state.requests.filter(r=>r.body.get('grant_type')==='refresh_token').length,1);
  assert.equal(readOAuthTokens(store,provider).refreshToken,'refresh-2');
  await manager.disconnect(id);assert.equal(store.state.providers.length,0);assert.equal(store.state.providerId,'');assert.equal(store.state.model,'');
  assert.equal(store.state.oauthRegistrations[0].oauth.clientId,'oaiapp_1');
  assert.equal(store.publicState().oauthRegistrations,undefined);
  const disk=await fs.readFile(store.file,'utf8');assert.ok(!disk.includes('encryptedOAuth'));assert.ok(!disk.includes('access-2'));
  const restarted=new Store(store.directory,store.secrets);await restarted.init('en');manager.store=restarted;
  assert.equal(state.requests.at(-1).body.get('client_id'),'oaiapp_1');assert.equal(state.requests.at(-1).body.get('token'),'refresh-2');
  assert.equal(await manager.connect('chatgpt'),id);assert.equal(state.authorizations.at(-1).newRegistration,false);assert.equal(state.authorizations.at(-1).clientId,'oaiapp_1');
  assert.equal(restarted.state.installationId,host);assert.equal(restarted.state.providers.length,1);assert.equal(restarted.state.oauthRegistrations.length,0);
});

test('failed code exchange persists the issued client before retry and restart',async t=>{
  const {store,manager,state}=await fixture(t);state.tokenError='invalid_grant';
  await assert.rejects(manager.connect('chatgpt'));const saved=store.state.providers[0];assert.equal(saved.oauth.clientId,'oaiapp_1');assert.equal(saved.encryptedOAuth,undefined);
  const restarted=new Store(store.directory,store.secrets);await restarted.init('en');assert.equal(restarted.state.providers[0].oauth.clientId,'oaiapp_1');
  state.tokenError='';await manager.connect('chatgpt',saved.id);assert.equal(state.client,1);
});

test('ID token signature claims and returning identity fail closed before replacing credentials',async t=>{
  const {store,manager,state}=await fixture(t),id=await manager.connect('chatgpt'),old=store.state.providers[0].encryptedOAuth;
  for(const flag of ['badSignature','badNonce','badAudience','badIssuer','expired']) {
    state[flag]=true;await assert.rejects(manager.connect('chatgpt',id));state[flag]=false;
    assert.equal(store.state.providers[0].encryptedOAuth,old);
  }
  state.subject='different-subject';await assert.rejects(manager.connect('chatgpt',id));assert.equal(store.state.providers[0].oauth.accountId,'subject-1');
});

test('plan permission is checked independently of identity; registrations with the same email remain separate',async t=>{
  const {store,manager,state}=await fixture(t);state.scopes='openid profile email offline_access resource.invoke';
  const id=await manager.connect('chatgpt');assert.equal(store.state.providers[0].oauth.planEnabled,false);
  await assert.rejects(manager.access(id),/Allow access/);
  state.scopes=definition.oauth.scopes.join(' ');await manager.connect('chatgpt',id);assert.equal(state.authorizations.at(-1).authorizationParameters.prompt,'consent');
  const second=await manager.connect('chatgpt');assert.notEqual(second,id);assert.equal(store.state.providers.length,2);
  assert.notEqual(store.state.providers[0].oauth.clientId,store.state.providers[1].oauth.clientId);
});

test('revocation failure keeps encrypted credentials for retry; terminal refresh clears unusable secrets',async t=>{
  const {store,manager,state}=await fixture(t),id=await manager.connect('chatgpt');
  state.revocationFails=true;await assert.rejects(manager.disconnect(id));await assert.rejects(manager.access(id));assert.ok(store.state.providers[0].encryptedOAuth);
  await assert.rejects(manager.connect('chatgpt',id));
  state.revocationFails=false;await manager.disconnect(id);await manager.connect('chatgpt');
  state.tokenError='invalid_grant';await assert.rejects(manager.access(id,'access-2'));
  assert.equal(store.state.providers[0].encryptedOAuth,undefined);assert.equal(store.state.providers[0].oauth.clientId,'oaiapp_1');
});

test('account switching preserves previous registrations and cancellation leaves them hidden',async t=>{
  const {store,manager,state}=await fixture(t),first=await manager.connect('chatgpt');
  await manager.disconnect(first);
  const authorize=manager.authorize;manager.authorize=async()=>{throw new Error('cancelled');};
  await assert.rejects(manager.connect('chatgpt'),/cancelled/);assert.equal(store.state.providers.length,0);assert.equal(store.state.oauthRegistrations.length,1);
  manager.authorize=authorize;state.subject='subject-2';const second=await manager.connect('chatgpt',undefined,null);
  assert.notEqual(first,second);assert.equal(state.client,2);await manager.disconnect(second);
  state.subject='subject-1';assert.equal(await manager.connect('chatgpt',undefined,first),first);
  assert.equal(state.client,2);assert.equal(store.state.oauthRegistrations[0].id,second);
});

test('loopback binds dynamic client, nonce, PKCE, resource and installation; rejects swapped client IDs',async()=>{
  let url;
  const result=await loopbackAuthorization({...definition.oauth,newRegistration:true},{installationId:'host-id',openExternal:async link=>{
    url=new URL(link);const callback=new URL(url.searchParams.get('redirect_uri'));
    callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','code');callback.searchParams.set('client_id','oaiapp_new');
    assert.equal((await fetch(callback)).status,200);
  }});
  assert.equal(result.nonce,url.searchParams.get('nonce'));assert.equal(result.clientId,'oaiapp_new');
  assert.equal(url.searchParams.get('ext_agent_host_id'),'urn:uuid:host-id');assert.equal(url.searchParams.get('resource'),definition.oauth.resource);
  assert.equal(url.searchParams.get('agent_name_hint'),'Archi Helper');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  for(const ids of [[],['oaiapp_other'],['oaiapp_selected','oaiapp_selected']]) {
    const newRegistration=!ids.length;
    await assert.rejects(loopbackAuthorization({...definition.oauth,newRegistration,clientId:newRegistration?'dynamic_agent_client':'oaiapp_selected'},
      {installationId:'host-id',openExternal:async link=>{const u=new URL(link),callback=new URL(u.searchParams.get('redirect_uri'));
        callback.searchParams.set('state',u.searchParams.get('state'));callback.searchParams.set('code','code');for(const id of ids)callback.searchParams.append('client_id',id);
        assert.equal((await fetch(callback)).status,400);
      }}));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Store } from '../electron/store.mjs';
import { OAuthManager } from '../electron/oauth-manager.mjs';
import { loopbackAuthorization } from '../electron/oauth-loopback.mjs';
import { oauthDefinition,oauthPost,tokenResponse } from '../electron/oauth-config.mjs';
import { readOAuthTokens } from '../electron/oauth-store.mjs';
import { api } from '../electron/provider.mjs';
import { ClaudeCode,findClaude } from '../electron/claude-code.mjs';
import { installClaude } from '../electron/claude-install.mjs';

const definition={id:'test-provider',name:'Test Provider',baseURL:'https://provider.example/v1',adapter:'openai-compatible',
  oauth:{clientId:'registered-public-client',authorizationURL:'https://identity.example/authorize',
    tokenURL:'https://identity.example/token',revocationURL:'https://identity.example/revoke',
    profileURL:'https://identity.example/me',scopes:['models:read','offline_access'],redirectPath:'/oauth/callback'}};

test('Claude uses official CLI authentication, persists only status, and requires explicit API billing selection',async t=>{
  const {store}=await fixture(t);let authMethod='claude.ai',email='synthetic@example.test',loggedIn=false;
  const calls=[];
  const manager=new ClaudeCode(store,{find:async value=>value||'C:/synthetic/claude.exe',run:async(executable,args,options)=>{
    calls.push(args);
    if(args[0]==='--version')return {code:0,stdout:'2.1.300 (Claude Code)'};
    if(args[1]==='login')loggedIn=true;
    if(args[1]==='logout')assert.fail('Disconnect must preserve the existing CLI login');
    return {code:loggedIn||args[1]==='logout'?0:1,stdout:JSON.stringify({loggedIn,authMethod,email,subscriptionType:'max',accessToken:'MUST-NOT-BE-SAVED'})};
  }});
  const id=await manager.connect(),provider=store.getProvider(id);
  assert.equal(provider.cli.authMethod,'claude.ai');assert.equal(store.publicState().providers[0].hasKey,true);
  assert.ok(calls.some(args=>args.join(' ')==='auth login'));
  assert.doesNotMatch(await fs.readFile(store.file,'utf8'),/MUST-NOT-BE-SAVED|accessToken/);
  assert.equal(provider.encryptedOAuth,undefined);
  await assert.rejects(store.provider({id,baseURL:'https://synthetic.example'}),/Claude/);
  authMethod='api_key';await assert.rejects(manager.verify(provider),/billing method changed/);
  assert.equal(store.getProvider(id).cli.authMethod,'claude.ai');
  await assert.rejects(manager.connect(),error=>error.code==='CLAUDE_OTHER_AUTH'&&/API or cloud credentials/.test(error.message));
  await manager.connect({allowOtherAuth:true});assert.equal(store.getProvider(id).cli.authMethod,'api_key');
  await manager.disconnect(id);assert.equal(store.state.providers.length,0);assert.equal(loggedIn,true);
});

test('Claude reuses an installed authenticated CLI and pins its profile without downloading or logging in',async t=>{
  const {store}=await fixture(t),shared=path.join(store.directory,'synthetic-shared'),calls=[],progress=[];
  const manager=new ClaudeCode(store,{env:{CLAUDE_CONFIG_DIR:shared},find:async()=>'/synthetic/claude.exe',install:async()=>assert.fail('Must not reinstall'),onProgress:value=>progress.push(value),run:async(_exe,args,options)=>{
    calls.push(args);assert.equal(options.env.CLAUDE_CONFIG_DIR,shared);
    if(args[0]==='--version')return {code:0,stdout:'2.1.312 (Claude Code)'};
    assert.deepEqual(args,['auth','status']);return {code:0,stdout:JSON.stringify({loggedIn:true,authMethod:'claude.ai',email:'synthetic@example.test',configDirectory:shared})};
  }});
  const id=await manager.connect();assert.equal(store.getProvider(id).cli.profile,'shared');
  manager.env={CLAUDE_CONFIG_DIR:path.join(store.directory,'another-profile')};await manager.verify(store.getProvider(id));
  await manager.disconnect(id);assert.ok(!calls.some(args=>args[1]==='login'||args[1]==='logout'));
  assert.deepEqual(progress.map(value=>value?.stage),['detecting','checking',undefined]);
});

test('Claude installs once when absent, starts official login only when needed, and reuses it on reconnect',async t=>{
  const {store}=await fixture(t);let installed=false,loggedIn=false,installs=0,logins=0;
  const manager=new ClaudeCode(store,{env:{},find:async()=>{if(!installed)throw Object.assign(new Error('missing'),{code:'CLAUDE_NOT_FOUND'});return '/synthetic/claude.exe';},
    install:async({signal,onProgress})=>{signal.throwIfAborted();installs++;onProgress({stage:'installing'});installed=true;return '/synthetic/claude.exe';},run:async(_exe,args)=>{
      if(args[0]==='--version')return {code:0,stdout:'2.1.312 (Claude Code)'};
      if(args[1]==='login'){logins++;loggedIn=true;}
      return {code:loggedIn?0:1,stdout:JSON.stringify({loggedIn,authMethod:loggedIn?'claude.ai':'none',email:'synthetic@example.test'})};
    }});
  const id=await manager.connect();await manager.connect();assert.equal(installs,1);assert.equal(logins,1);assert.equal(store.state.providers.length,1);
  assert.equal(store.getProvider(id).cli.profile,'shared');assert.equal(manager.pending,null);assert.equal(manager.progress,null);
});

test('Claude preserves legacy private sign-in and cancels automatic setup without saving a connection',async t=>{
  const {store}=await fixture(t),privateDirectory=path.join(store.directory,'claude-code');
  store.state.providers.push({id:'synthetic-existing',adapter:'claude-code',cli:{status:'connected',authMethod:'claude.ai'},executable:'/synthetic/claude.exe'});
  const existing=new ClaudeCode(store,{find:async value=>value,run:async(_exe,args,options)=>{
    if(args[0]==='--version')return {code:0,stdout:'2.1.312 (Claude Code)'};
    assert.deepEqual(args,['auth','status']);assert.equal(options.env.CLAUDE_CONFIG_DIR,privateDirectory);
    return {code:0,stdout:JSON.stringify({loggedIn:true,authMethod:'claude.ai'})};
  }});
  assert.equal(await existing.connect(),'synthetic-existing');assert.equal(store.state.providers[0].cli.profile,'private');
  await existing.disconnect('synthetic-existing');
  let started;const installing=new Promise(resolve=>{started=resolve;});
  const manager=new ClaudeCode(store,{find:async()=>{throw Object.assign(new Error('missing'),{code:'CLAUDE_NOT_FOUND'});},install:async({signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});started();})});
  const pending=manager.connect();await installing;await assert.rejects(manager.connect(),/current connection/i);manager.cancel();await assert.rejects(pending);
  assert.equal(store.state.providers.length,0);assert.equal(manager.pending,null);assert.equal(manager.progress,null);
});

test('Claude native discovery includes user and current npm binary layouts',async t=>{
  const {store}=await fixture(t),home=path.join(store.directory,'synthetic-home'),prefix=path.join(store.directory,'synthetic-npm');
  const native=path.join(home,'.local','bin','claude.exe'),npm=path.join(prefix,'node_modules','@anthropic-ai','claude-code','bin','claude.exe');
  await fs.mkdir(path.dirname(npm),{recursive:true});await fs.writeFile(npm,'synthetic');
  assert.equal(await findClaude(undefined,{env:{PATH:prefix},home,platform:'win32'}),npm);
  await fs.mkdir(path.dirname(native),{recursive:true});await fs.writeFile(native,'synthetic');
  assert.equal(await findClaude(undefined,{env:{PATH:prefix},home,platform:'win32'}),native);
  await assert.rejects(findClaude(path.join(home,'missing.exe'),{env:{},home,platform:'win32'}),{code:'CLAUDE_NOT_FOUND'});
});

test('Claude installer verifies official download size and digest before running the native installer',async t=>{
  const {store}=await fixture(t),folder=path.join(store.directory,'downloads'),bytes=Buffer.from('synthetic native installer'),version='2.1.312';let corrupt=false,runCount=0;
  const checksum=crypto.createHash('sha256').update(bytes).digest('hex'),requests=[],progress=[];
  const fetcher=async(url,options)=>{
    requests.push(url);assert.equal(options.redirect,'error');assert.ok(url.startsWith('https://downloads.claude.ai/claude-code-releases/'));
    if(url.endsWith('/latest'))return new Response(version);
    if(url.endsWith('/manifest.json'))return Response.json({version,platforms:{'win32-x64':{binary:'claude.exe',size:bytes.length,checksum}}});
    return new Response(corrupt?Buffer.alloc(bytes.length):bytes);
  };
  const input={folder,fetcher,platform:'win32',arch:'x64',signal:new AbortController().signal,options:{},find:async()=>'/synthetic/installed.exe',onProgress:value=>progress.push(value.stage),run:async(file,args)=>{
    runCount++;
    if(args[0]==='install'){assert.deepEqual(args,['install',version]);assert.deepEqual(await fs.readFile(file),bytes);return {code:0};}
    return {code:0,stdout:`${version} (Claude Code)`};
  }};
  assert.equal(await installClaude(input),'/synthetic/installed.exe');assert.equal(runCount,2);assert.deepEqual(await fs.readdir(folder),[]);
  assert.ok(progress.includes('verifying')&&progress.includes('installing'));assert.equal(requests.length,3);
  corrupt=true;await assert.rejects(installClaude(input),/integrity/);assert.equal(runCount,2);assert.deepEqual(await fs.readdir(folder),[]);
});

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

test('OAuth failures preserve safe diagnostics for nested errors and redact submitted credentials',async()=>{
  await assert.rejects(oauthPost('https://identity.example/token',{code:'one-use-secret',code_verifier:'private-verifier'},async()=>
    Response.json({error:{code:'invalid_client',message:'Rejected one-use-secret and private-verifier'}},{status:401,headers:{'x-request-id':'request-123'}})),error=>{
      assert.equal(error.oauthCode,'invalid_client');assert.equal(error.status,401);assert.equal(error.requestId,'request-123');
      assert.match(error.message,/invalid_client/);assert.ok(!error.message.includes('one-use-secret'));assert.ok(!error.message.includes('private-verifier'));return true;
    });
});

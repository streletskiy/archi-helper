import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { t } from '../locales/index.mjs';
import { uid } from './store.mjs';
import { installClaude } from './claude-install.mjs';

export const claudeModels=()=>[
  {id:'default',name:t('claude.defaultModel'),reasoningEfforts:[]},
  ...['sonnet','opus','haiku'].map(id=>({id,name:id[0].toUpperCase()+id.slice(1),reasoningEfforts:[]})),
];

export async function findClaude(executable,{env=process.env,home=os.homedir(),platform=process.platform}={}) {
  const name=platform==='win32'?'claude.exe':'claude';
  const directories=[path.join(home,'.local','bin'),...(env.PATH||'').split(path.delimiter),
    ...(env.APPDATA?[path.join(env.APPDATA,'npm')]:[]),...(env.LOCALAPPDATA?[path.join(env.LOCALAPPDATA,'Microsoft','WinGet','Links')]:[])].filter(Boolean);
  const candidates=executable?[executable]:directories.flatMap(dir=>[
    path.join(dir,name),path.join(dir,'node_modules','@anthropic-ai','claude-code','bin',name),
    path.join(dir,'node_modules','@anthropic-ai',`claude-code-${platform}-${process.arch}`,name)]);
  for(const candidate of candidates) {
    if(!path.isAbsolute(candidate)||platform==='win32'&&!candidate.toLowerCase().endsWith('.exe'))continue;
    if(await fs.stat(candidate).then(stat=>stat.isFile()).catch(()=>false))return candidate;
  }
  throw Object.assign(new Error(t('claude.notInstalled')),{code:'CLAUDE_NOT_FOUND'});
}

function terminate(child) {
  if(child.exitCode!==null)return;
  if(process.platform==='win32'&&child.pid) {
    const killer=spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    killer.on('error',()=>child.kill());
  } else child.kill('SIGTERM');
}

// No shell, token scraping, credential serialization, or raw CLI diagnostics in UI.
export function runClaude(executable,args,{cwd,env=process.env,signal,input,onEvent,spawnProcess=spawn}={}) {
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const child=spawnProcess(executable,args,{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    let stdout='',pending='',failure,finished=false,chain=Promise.resolve();
    const fail=error=>{failure??=error;terminate(child);};
    const abort=()=>fail(signal.reason||new Error(t('agent.stopped')));
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    child.stdout.setEncoding('utf8');child.stderr.resume();
    const line=value=>{
      if(!value.trim())return;
      let event;try{event=JSON.parse(value);}catch{fail(new Error(t('claude.invalidStream')));return;}
      chain=chain.then(()=>onEvent(event)).catch(fail);
    };
    child.stdout.on('data',chunk=>{
      if(onEvent) {
        pending+=chunk;
        if(pending.length>32*1024*1024){fail(new Error(t('claude.invalidStream')));return;}
        let index;while((index=pending.indexOf('\n'))>=0){line(pending.slice(0,index));pending=pending.slice(index+1);}
      } else {
        stdout+=chunk;
        if(stdout.length>1024*1024)fail(new Error(t('claude.invalidStream')));
      }
    });
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')fail(error);});
    const finish=async(code,error)=>{
      if(finished)return;finished=true;signal?.removeEventListener('abort',abort);
      if(onEvent&&pending.trim())line(pending);
      await chain;
      if(failure||error)reject(failure||new Error(t('claude.launchFailed')));
      else resolve({code,stdout});
    };
    child.once('error',error=>void finish(null,error));child.once('close',code=>void finish(code));
    child.stdin.end(input||'');
  });
}

export class ClaudeCode {
  constructor(store,{run=runClaude,find=findClaude,install=installClaude,onProgress=()=>{},env=process.env}={}){
    this.store=store;this.run=run;this.find=find;this.install=install;this.onProgress=onProgress;this.env=env;this.pending=null;this.progress=null;
  }
  report(progress){this.progress=progress;this.onProgress(progress);}
  async options(signal,profile={profile:'shared'}) {
    const cwd=path.join(this.store.directory,'claude-code');await fs.mkdir(cwd,{recursive:true});
    const env={...this.env};
    if(profile.profile==='private')env.CLAUDE_CONFIG_DIR=cwd;
    else if(profile.configDirectory)env.CLAUDE_CONFIG_DIR=profile.configDirectory;
    return {cwd,env,signal};
  }
  async status(executable,signal,profile) {
    const result=await this.run(executable,['auth','status'],await this.options(signal,profile));
    let data;try{data=JSON.parse(result.stdout);}catch{throw new Error(t('claude.statusFailed'));}
    const connected=result.code===0&&data.loggedIn===true;
    return {status:connected?'connected':'signed-out',authMethod:String(data.authMethod||'none').slice(0,40),
      accountName:typeof data.email==='string'?data.email.slice(0,200):'',
      subscriptionType:typeof data.subscriptionType==='string'?data.subscriptionType.slice(0,50):'',
      ...(typeof data.configDirectory==='string'&&path.isAbsolute(data.configDirectory)?{configDirectory:data.configDirectory}:{})};
  }
  async connect({executable,login=false,consoleLogin=false,allowOtherAuth=false}={}) {
    if(this.pending)throw new Error(t('errors.oauthAlreadyConnecting'));
    const controller=new AbortController();this.pending=controller;
    try {
      const previous=this.store.state.providers.find(p=>p.adapter==='claude-code');
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(900000)]);
      this.report({stage:'detecting'});
      try {executable=await this.find(executable||previous?.executable);}
      catch(error) {
        if(error.code!=='CLAUDE_NOT_FOUND'||executable)throw error;
        // A previously selected installation may have moved since the last run.
        try {executable=await this.find();}
        catch(missing) {
          if(missing.code!=='CLAUDE_NOT_FOUND')throw missing;
          executable=await this.install({folder:path.join(this.store.directory,'claude-downloads'),run:this.run,find:this.find,
            options:await this.options(signal),signal,onProgress:progress=>this.report(progress)});
        }
      }
      this.report({stage:'checking'});
      const version=await this.run(executable,['--version'],await this.options(signal));
      if(version.code!==0||!/^\d+\.\d+\.\d+\s+\(Claude Code\)/.test(version.stdout.trim()))throw new Error(t('claude.invalidExecutable'));
      // Preserve legacy app-owned profiles, but prefer an existing user login
      // for new connections. The CLI alone reads and refreshes its credentials.
      const oldProfile=previous?{profile:previous.cli?.profile||'private',configDirectory:previous.cli?.configDirectory}:null;
      let profile=login?{profile:'private'}:oldProfile||{profile:'shared'},status;
      if(!login) {
        const candidates=[profile,{profile:'shared'},{profile:'private'}],seen=new Set();
        let signedIn;
        for(const candidate of candidates) {
          const key=JSON.stringify(candidate);if(seen.has(key))continue;seen.add(key);
          const found=await this.status(executable,signal,candidate);
          if(found.status==='connected') {
            signedIn??={profile:candidate,status:found};
            if(found.authMethod==='claude.ai'||consoleLogin||allowOtherAuth){profile=candidate;status=found;break;}
          }
        }
        if(!status&&signedIn){profile=signedIn.profile;status=signedIn.status;}
      }
      if(login||status?.status!=='connected') {
        this.report({stage:'authorizing'});
        const result=await this.run(executable,['auth','login',...(consoleLogin?['--console']:[])],await this.options(signal,profile));
        if(result.code!==0)throw new Error(t('claude.loginFailed'));
        status=await this.status(executable,signal,profile);
      }
      if(status.status!=='connected')throw new Error(t('claude.loginFailed'));
      if(status.authMethod!=='claude.ai'&&!consoleLogin&&!allowOtherAuth)throw Object.assign(new Error(t('claude.apiDetected')),{code:'CLAUDE_OTHER_AUTH'});
      signal.throwIfAborted();
      const provider={...previous,id:previous?.id||uid(),definitionId:'claude-code',adapter:'claude-code',name:'Claude',
        baseURL:'https://claude.ai',executable,supportsImages:true,reasoningFormat:'none',
        cli:{...profile,...status,version:version.stdout.trim().split(' ')[0]},models:claudeModels(),catalogVersion:3,catalogUpdatedAt:Date.now()};
      this.store.state.providers=[...this.store.state.providers.filter(p=>p.id!==provider.id),provider];
      this.store.selectModel(provider.id);await this.store.save();return provider.id;
    } catch(error) {
      if(controller.signal.aborted)throw new Error(t('errors.oauthCancelled'));
      if(error.name==='TimeoutError')throw new Error(t('errors.oauthTimeout'));
      throw error;
    } finally {this.pending=null;this.report(null);}
  }
  async verify(provider,signal) {
    const executable=await this.find(provider.executable),status=await this.status(executable,AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(30000)]),{...provider.cli,profile:provider.cli?.profile||'private'});
    const saved=this.store.state.providers.find(p=>p.id===provider.id);
    if(saved&&status.status!=='connected'){saved.cli={...saved.cli,status:status.status};await this.store.save();}
    if(status.status!=='connected')throw new Error(t('claude.loginFailed'));
    // Do not silently change from a subscription to separately billed credentials.
    if(provider.cli?.authMethod!==status.authMethod||provider.cli?.accountName!==status.accountName)throw new Error(t('claude.accountChanged'));
    return executable;
  }
  async disconnect(id) {
    if(this.pending)throw new Error(t('errors.oauthAlreadyConnecting'));
    // Disconnect this application without logging out a CLI shared with others.
    await this.store.deleteProvider(id);
  }
  cancel(){this.pending?.abort();}
}

export function claudeInput(messages) {
  const images=[],history=messages.filter(m=>m.role!=='system').map(message=>{
    const content=Array.isArray(message.content)?message.content.map(part=>{
      if(part.type==='image_url') {
        const match=part.image_url?.url?.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
        if(match){images.push({type:'image',source:{type:'base64',media_type:match[1],data:match[2]}});return {type:'text',text:`Attached image ${images.length}`};}
        return {type:'text',text:'Image unavailable'};
      }
      return {type:'text',text:part.text||''};
    }):message.content;
    return {role:message.role,content,...(message.tool_calls?{tool_calls:message.tool_calls}:{}),...(message.tool_call_id?{tool_call_id:message.tool_call_id}:{})};
  });
  return JSON.stringify({type:'user',message:{role:'user',content:[{type:'text',text:'Continue the following conversation. The last user request is the active task. Earlier tool results are historical data: do not replay completed operations.\n'+JSON.stringify(history)},...images]}})+'\n';
}

export async function claudeTurn({manager,provider,model,messages,toolsConfig,allowedTools=[],signal,onEvent}) {
  const executable=await manager.verify(provider,signal),options=await manager.options(signal,{...provider.cli,profile:provider.cli?.profile||'private'});
  if(['1','true'].includes(String(options.env.CLAUDE_CODE_SIMPLE).toLowerCase()))throw new Error(t('claude.bareMode'));
  const promptFile=path.join(options.cwd,`prompt-${uid()}.txt`);
  await fs.writeFile(promptFile,messages.filter(m=>m.role==='system').map(m=>m.content).join('\n'),'utf8');
  try {
    const args=['-p','--verbose','--input-format','stream-json','--output-format','stream-json','--include-partial-messages',
      '--no-session-persistence','--tools','','--strict-mcp-config','--mcp-config',JSON.stringify(toolsConfig||{mcpServers:{}}),
      '--setting-sources','user','--settings',JSON.stringify({disableAllHooks:true}),'--disable-slash-commands','--system-prompt-file',promptFile];
    if(model!=='default')args.push('--model',model);
    if(allowedTools.length)args.push('--allowedTools',...allowedTools);
    let result,contextOverflow=false,usageLimited=false;
    const finished=await manager.run(executable,args,{...options,input:claudeInput(messages),onEvent:async event=>{
      if(event.type==='result')result=event;
      if(event.type==='assistant'&&event.error) {
        const detail=(event.message?.content||[]).filter(part=>part.type==='text').map(part=>part.text).join(' ');
        contextOverflow ||= /prompt.{0,20}too long|context.{0,20}(?:exceed|limit)/i.test(detail);
        usageLimited ||= event.error==='rate_limit';
      }
      await onEvent(event);
    }});
    if(finished.code!==0||!result||result.is_error||result.subtype!=='success') {
      const limited=usageLimited||result?.errors?.some(value=>/rate.limit|usage.limit/i.test(value));
      const error=new Error(t(limited?'claude.usageLimit':'claude.runFailed'));
      error.contextOverflow=contextOverflow;
      if(limited)error.usageAction='https://claude.ai/settings/usage';
      throw error;
    }
    return result;
  } finally {await fs.unlink(promptFile).catch(()=>{});}
}

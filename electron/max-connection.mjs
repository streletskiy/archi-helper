import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {MCP} from './mcp.mjs';
import {maxCommands,maxMcpVersion,maxBridgeVersion,maxYear} from './max-catalog.mjs';
import {callMaxSession,sessionPipe,sessionTools} from './max-session.mjs';
import {imageFile,projectPath} from './store.mjs';
import {validatePng} from './png-validation.mjs';
import {resultData} from './progress.mjs';
import {t} from '../locales/index.mjs';

const exists=file=>fs.access(file).then(()=>true,()=>false);
const pluginRoot=base=>path.join(base,'Autodesk','ApplicationPlugins');
const exec=promisify(execFile);

// Autodesk discovers per-user script packages on launch, including localized installations.
// Publish the Python payload before the startup manifest. Repeated scans don't rewrite files.
async function provisionSession(script) {
  const dir=path.join(pluginRoot(process.env.APPDATA),'ArchiHelper-Max2022');
  await fs.mkdir(dir,{recursive:true});
  const manifest=await fs.readFile(path.join(dir,'PackageContents.xml'),'utf8').catch(error=>{if(error.code!=='ENOENT')throw error;});
  if(manifest&&!manifest.includes('{37347C7C-3872-453F-9926-C9FF796D30DD}'))throw new Error(t('max.error'));
  for(const name of ['archi_helper.py','archi_helper_startup.ms','PackageContents.xml']){
    const source=await fs.readFile(path.join(path.dirname(script),name));
    const destination=path.join(dir,name);
    const existing=await fs.readFile(destination).catch(error=>{if(error.code!=='ENOENT')throw error;});
    if(existing?.equals(source))continue;
    const staged=path.join(dir,'.'+crypto.randomUUID()+'.tmp');
    try {await fs.writeFile(staged,source,{flag:'wx'});await fs.rename(staged,destination);}
    finally {await fs.rm(staged,{force:true});}
  }
}

// Max loads its GUPs at startup. Publish the entire per-user bundle in one rename.
// Respect existing upstream installations, including installs for all users.
export async function provisionMax(runtime) {
  const local=pluginRoot(process.env.APPDATA),shared=pluginRoot(process.env.ProgramData);
  const external='3dsmax-mcp',owned='ArchiHelper-3dsmax-mcp';
  for(const root of [shared,local])if(await exists(path.join(root,external,'PackageContents.xml')))return;
  const destination=path.join(local,owned);
  const manifest=path.join(destination,'PackageContents.xml');
  if(await exists(manifest)){
    const xml=await fs.readFile(manifest,'utf8');
    if(xml.includes('AppVersion="'+maxMcpVersion+'"'))return;
    throw new Error(t('max.error'));
  }
  const staged=path.join(local,'.archi-max-'+crypto.randomUUID());
  await fs.mkdir(local,{recursive:true});
  try {
    await fs.cp(path.join(runtime,'max-mcp',external),staged,{recursive:true,errorOnExist:true});
    await fs.rename(staged,destination);
  } catch(error){if(!await exists(manifest))throw error;}
  finally{await fs.rm(staged,{recursive:true,force:true});}
}

async function maxProcesses() {
  const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const script=[
    '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)',
    "$dirs=@((Get-ItemProperty 'HKLM:\\SOFTWARE\\Autodesk\\3dsMax\\24.0' -ErrorAction SilentlyContinue).Installdir, (Join-Path $env:ProgramFiles 'Autodesk\\3ds Max 2022'))",
    "$legacy=$dirs | Where-Object { $_ } | ForEach-Object { Join-Path $_ '3dsmax.exe' } | Where-Object { (Test-Path -LiteralPath $_ -PathType Leaf) -and [Diagnostics.FileVersionInfo]::GetVersionInfo($_).ProductMajorPart -eq 24 } | Select-Object -First 1",
    "$running=@(Get-Process -Name 3dsmax -ErrorAction SilentlyContinue | ForEach-Object { if ($_.Path) { [PSCustomObject]@{pid=$_.Id; title=$_.MainWindowTitle; year=1998+[Diagnostics.FileVersionInfo]::GetVersionInfo($_.Path).ProductMajorPart; started=$_.StartTime.ToUniversalTime().Ticks.ToString()} } })",
    '[PSCustomObject]@{running=$running;legacy=[string]$legacy} | ConvertTo-Json -Compress'
  ].join('; ');
  const {stdout}=await exec(shell,['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:10000});
  return JSON.parse(stdout);
}

export class MaxConnection {
  constructor(runtime,onChange=()=>{},sessionScript) {
    this.runtime=runtime;this.onChange=onChange;this.clients=new Map();
    this.sessionScript=sessionScript;
    this.state={status:'searching',instances:[]};
  }
  refresh(force=false) {
    if(!force&&!this.pending&&Date.now()-this.lastScan<2000)return Promise.resolve(this.state);
    this.pending??=this.scan().catch(()=>this.update({status:'error',instances:[]})).finally(()=>{this.lastScan=Date.now();this.pending=null;});
    return this.pending;
  }
  update(state){
    if(JSON.stringify(state)!==JSON.stringify(this.state)){this.state=state;this.onChange(state);}
    return this.state;
  }
  async scan() {
    const {running,legacy}=await maxProcesses();
    this.legacyExecutable=legacy;
    const available=running.filter(item=>maxYear(item.year));
    const native=available.filter(item=>item.year>2022);
    let provisionError=false;
    if(this.sessionScript&&!this.sessionPrepared&&(legacy||available.some(item=>item.year===2022))){
      try {await provisionSession(this.sessionScript);this.sessionPrepared=true;} catch { /* Manual connection is still available. */ }
    }
    if(!this.provisioned&&(native.length||
      (await Promise.all([2023,2024,2025,2026,2027].map(year=>exists(path.join(process.env.ProgramFiles,'Autodesk','3ds Max '+year))))).some(Boolean))){
      try {await provisionMax(this.runtime);this.provisioned=true;} catch {provisionError=true;}
    }
    const pipes=new Set(available.length?await fs.readdir('\\\\.\\pipe\\'):[]);
    const instances=available.map(item=>({...item,ready:pipes.has(item.year===2022?sessionPipe(item.pid):'3dsmax-mcp-pid-'+item.pid)}));
    for(const [key,promise] of this.clients)if(!instances.some(item=>item.ready&&this.key(item)===key)){
      this.clients.delete(key);void promise.then(client=>client.close()).catch(()=>{});
    }
    const needsSession=instances.some(item=>item.year===2022&&!item.ready);
    const status=instances.some(item=>item.ready)?'connected':needsSession?(this.sessionPrepared?'session':'manual'):provisionError?'error':native.length?'restart':running.length?'unsupported':'offline';
    return this.update({status,instances,autoStart2022:!!this.sessionPrepared,canLaunch2022:!!legacy&&!this.startingLegacy&&!instances.some(item=>item.year===2022)});
  }
  async launch2022(script) {
    await this.refresh(true);
    if(!this.state.canLaunch2022||!this.legacyExecutable||this.startingLegacy)throw new Error(t('max.check'));
    await fs.access(script);
    if(this.startingLegacy)throw new Error(t('max.check'));
    const child=spawn(this.legacyExecutable,['-U','PythonHost',script],{detached:true,stdio:'ignore'});
    this.startingLegacy=child;
    child.once('close',()=>{this.startingLegacy=null;});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    child.unref();
    this.update({...this.state,canLaunch2022:false});
  }
  key(item){return item.pid+'/'+item.started;}
  selected(session,pid) {
    const instances=this.state.instances;
    return pid!==undefined?instances.find(item=>item.pid===pid):session?.maxTarget?instances.find(item=>this.key(item)===session.maxTarget):instances.length===1?instances[0]:null;
  }
  help(item) {
    if(item?.year===2022&&this.sessionScript)return t(this.sessionPrepared?'max.restartPath':'max.manualPath',{path:this.sessionScript});
    return t('max.'+(item&&!item.ready&&this.state.status==='connected'?'restart':this.state.status));
  }
  environment(session,pid) {
    const ready=this.state.instances.filter(item=>item.ready);
    const item=pid!==undefined?ready.find(x=>x.pid===pid):session?.maxTarget?ready.find(x=>this.key(x)===session.maxTarget):this.state.instances.length===1?ready[0]:null;
    return item?{max_year:item.year,max_bridge:maxBridgeVersion(item.year),max_target:this.key(item)}:{};
  }
  async target(session,pid) {
    await this.refresh();
    const selected=this.selected(session,pid);
    if(!selected)throw new Error(this.state.instances.length?t('max.select'):this.help());
    if(session.maxTarget&&this.key(selected)!==session.maxTarget&&this.state.instances.some(item=>this.key(item)===session.maxTarget))throw new Error(t('max.select'));
    if(!selected.ready)throw new Error(this.help(selected));
    return selected;
  }
  async client(item) {
    const key=this.key(item);
    if(!this.clients.has(key)){
      const pending=(async()=>{
        const server=new MCP(this.runtime);
        const env={};
        for(const name of ['SystemRoot','PATH','TEMP','TMP','APPDATA','LOCALAPPDATA','ProgramData','USERPROFILE','PROGRAMFILES','PROGRAMFILES(X86)'])
          if(process.env[name])env[name]=process.env[name];
        Object.assign(env,{MCP_MAX_PID:String(item.pid),MCP_TOOL_PROFILE:'full',MCP_TOOL_DOCS:'complete',PYTHONUTF8:'1'});
        const command=path.join(this.runtime,'max-mcp','runtime','python.exe');
        try{
          await server.add('max',new StdioClientTransport({command,args:['-B','-c','from maxmcp.server import main; main()'],env,stderr:'pipe'}));
          return server;
        }catch(error){await server.close();throw error;}
      })();
      this.clients.set(key,pending);
      pending.catch(()=>{if(this.clients.get(key)===pending)this.clients.delete(key);});
    }
    return this.clients.get(key);
  }
  async discover(session,query,pid) {
    await this.refresh();
    let item,error;
    try {item=await this.target(session,pid);} catch(caught){error=caught;}
    const instances=this.state.instances.map(({pid,year,ready,title})=>({pid,year,ready,title}));
    if(error)return {instances,status:this.state.status,message:error.message};
    const tools=item.year===2022?sessionTools:(await this.client(item)).tools;
    const name=String(query||'').replace(/^max:/,'');
    const exact=tools.find(tool=>tool.name===name&&maxCommands.includes(name));
    return {instances,pid:item.pid,year:item.year,tools:exact?[{name:exact.name,description:exact.description,inputSchema:exact.inputSchema}]:
      tools.filter(tool=>maxCommands.includes(tool.name)).map(tool=>tool.name)};
  }
  async call(item,name,args,signal) {
    if(!maxCommands.includes(name))throw new Error(t('max.unknown'));
    // Revalidate the process lifetime even if a confirmation dialog was open for a while.
    await this.refresh(true);
    const current=await this.target({maxTarget:this.key(item)});
    if(current.year===2022)return callMaxSession(current,name,args,signal);
    const server=await this.client(current);
    const response=await server.call('max:'+name,{...args,expected_pid:current.pid},signal);
    const data=resultData(response);
    if(response.isError)return {isError:true,error:typeof data==='string'?data:JSON.stringify(data)};
    if(data?.ok===false)return {isError:true,error:data.error?.message||t('max.error'),code:data.error?.code,outcomeUnknown:data.error?.code==='REQUEST_OUTCOME_UNKNOWN',hint:data.hint};
    const value=data?.ok===true?data.result:data;
    // Some upstream tools return JSON as text, including errors inside successful MCP envelopes.
    let parsed=value;if(typeof value==='string')try{parsed=JSON.parse(value);}catch{}
    if(parsed?.error||parsed?.status==='error'||parsed?.success===false)return {isError:true,details:parsed};
    if(data?.warnings?.length)return {result:parsed,warnings:data.warnings};
    return parsed;
  }
  async close(){
    await this.pending;
    await Promise.allSettled([...this.clients.values()].map(async client=>(await client).close()));this.clients.clear();
  }
}

export async function saveMaxViewport(data,root) {
  const temp=await fs.realpath(os.tmpdir()),source=await fs.realpath(data?.file||data?.result?.file||'');
  const relative=path.relative(temp,source);
  const capture=relative.split(path.sep).join('/');
  if(!/^(?:3dsmax_mcp_multiview_\d+_\d+_\d+|3dsmax-mcp\/viewport_[0-9a-f]{32})\.png$/i.test(capture))throw new Error(t('max.imageError'));
  const {data:bytes}=await imageFile(temp,relative);
  validatePng(bytes);
  const imagePath='.archi/images/'+crypto.randomUUID()+'.png';
  const destination=await projectPath(root,imagePath);
  await fs.mkdir(path.dirname(destination),{recursive:true});
  await fs.writeFile(destination,bytes,{flag:'wx'});
  return {imagePath,mime:'image/png',shownToUser:true,caption:t('max.viewport')};
}

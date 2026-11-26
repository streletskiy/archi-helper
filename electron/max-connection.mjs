import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {MCP} from './mcp.mjs';
import {maxCommands,maxMcpVersion,maxYear} from './max-catalog.mjs';
import {imageFile,projectPath} from './store.mjs';
import {validatePng} from './png-validation.mjs';
import {resultData} from './progress.mjs';
import {t} from '../locales/index.mjs';

const exists=file=>fs.access(file).then(()=>true,()=>false);
const pluginRoot=base=>path.join(base,'Autodesk','ApplicationPlugins');
const exec=promisify(execFile);

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
  const script="[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @(Get-Process -Name 3dsmax -ErrorAction SilentlyContinue) | ForEach-Object { if ($_.Path) { [PSCustomObject]@{pid=$_.Id; title=$_.MainWindowTitle; year=1998+[Diagnostics.FileVersionInfo]::GetVersionInfo($_.Path).ProductMajorPart; started=$_.StartTime.ToUniversalTime().Ticks.ToString()} } } | ConvertTo-Json -Compress";
  const {stdout}=await exec(shell,['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:10000});
  return stdout.trim()?[].concat(JSON.parse(stdout)):[];
}

export class MaxConnection {
  constructor(runtime,onChange=()=>{}) {
    this.runtime=runtime;this.onChange=onChange;this.clients=new Map();
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
    const running=await maxProcesses();
    const available=running.filter(item=>maxYear(item.year));
    if(!this.provisioned&&(available.length||await exists(path.join(process.env.LOCALAPPDATA,'Autodesk','3dsMax'))||
      (await Promise.all([2023,2024,2025,2026,2027].map(year=>exists(path.join(process.env.ProgramFiles,'Autodesk','3ds Max '+year))))).some(Boolean))){
      await provisionMax(this.runtime);this.provisioned=true;
    }
    const pipes=new Set(available.length?await fs.readdir('\\\\.\\pipe\\'):[]);
    const instances=available.map(item=>({...item,ready:pipes.has('3dsmax-mcp-pid-'+item.pid)}));
    for(const [key,promise] of this.clients)if(!instances.some(item=>item.ready&&this.key(item)===key)){
      this.clients.delete(key);void promise.then(client=>client.close()).catch(()=>{});
    }
    return this.update({status:instances.some(item=>item.ready)?'connected':available.length?'restart':running.length?'unsupported':'offline',instances});
  }
  key(item){return item.pid+'/'+item.started;}
  environment(session,pid) {
    const ready=this.state.instances.filter(item=>item.ready);
    const item=pid!==undefined?ready.find(x=>x.pid===pid):session?.maxTarget?ready.find(x=>this.key(x)===session.maxTarget):this.state.instances.length===1?ready[0]:null;
    return item?{max_year:item.year,max_bridge:maxMcpVersion,max_target:this.key(item)}:{};
  }
  async target(session,pid) {
    await this.refresh();
    const ready=this.state.instances.filter(item=>item.ready);
    if(!ready.length)throw new Error(t('max.'+this.state.status));
    const selected=pid!==undefined?ready.find(item=>item.pid===pid):session.maxTarget?ready.find(item=>this.key(item)===session.maxTarget):this.state.instances.length===1?ready[0]:null;
    if(session.maxTarget&&selected&&this.key(selected)!==session.maxTarget&&ready.some(item=>this.key(item)===session.maxTarget))throw new Error(t('max.select'));
    if(!selected)throw new Error(t('max.select'));
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
    const state=await this.refresh();
    const instances=state.instances.map(({pid,year,ready,title})=>({pid,year,ready,title}));
    if(!instances.some(item=>item.ready))return {instances,status:state.status,message:t('max.'+state.status)};
    if(!pid&&(session.maxTarget?!state.instances.some(item=>item.ready&&this.key(item)===session.maxTarget):instances.length>1))return {instances,message:t('max.select')};
    const item=await this.target(session,pid);
    const server=await this.client(item);
    const name=String(query||'').replace(/^max:/,'');
    const exact=server.tools.find(tool=>tool.name===name&&maxCommands.includes(name));
    return {instances,pid:item.pid,year:item.year,tools:exact?[{name:exact.name,description:exact.description,inputSchema:exact.inputSchema}]:
      server.tools.filter(tool=>maxCommands.includes(tool.name)).map(tool=>tool.name)};
  }
  async call(item,name,args,signal) {
    if(!maxCommands.includes(name))throw new Error(t('max.unknown'));
    // Revalidate the process lifetime even if a confirmation dialog was open for a while.
    await this.refresh(true);
    const current=await this.target({maxTarget:this.key(item)});
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

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {t} from '../locales/index.mjs';
import {sanitizeFinding} from './finding-schema.mjs';

const WEEK=7*24*60*60*1000,MAX_RECORDS=1000,MAX_BYTES=8*1024*1024;
const revision=({delivery,...value})=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const localMetadata=value=>(value.title===undefined||typeof value.title==='string'&&value.title.trim().length>0&&value.title.length<=120)&&
  (value.keywords===undefined||Array.isArray(value.keywords)&&value.keywords.length<=12&&value.keywords.every(word=>typeof word==='string'&&word.trim().length>0&&word.length<=40));
const fail=()=>{throw new Error(t('findings.invalid'));};

export class AgentFindings {
  constructor(directory) {this.root=directory?path.join(directory,'agent-findings'):null;this.writes=Promise.resolve();this.generation=0;}
  mutate(action) {const result=this.writes.catch(()=>{}).then(action);this.writes=result;return result;}
  async readState() {
    if(!this.root)return {schema:1,records:[]};
    try {
      if((await fs.lstat(this.root)).isSymbolicLink())fail();
      const file=path.join(this.root,'findings.json'),stat=await fs.lstat(file);
      if(stat.isSymbolicLink()||!stat.isFile()||stat.size>MAX_BYTES)fail();
      const state=JSON.parse(await fs.readFile(file,'utf8'));
      if(state?.schema!==1||!Array.isArray(state.records)||state.records.length>MAX_RECORDS)fail();
      const seen=new Set();
      for(const record of state.records) {
        const card=sanitizeFinding(record.card);
        if(!card||card.fingerprint!==record.card.fingerprint||seen.has(card.fingerprint)||typeof record.notes!=='string'||record.notes.length>4000||
          !['candidate','observed'].includes(record.confidence)||typeof record.enabled!=='boolean'||typeof record.pinned!=='boolean'||!localMetadata(record))fail();
        if(record.delivery&&(!uuid(record.delivery.installationId)||!uuid(record.delivery.eventId)||record.delivery.deliveredAt!==undefined&&(!Number.isFinite(record.delivery.deliveredAt)||record.delivery.deliveredAt<0)))fail();
        if(record.archive&&(!['user','bundled'].includes(record.archive.reason)||record.archive.reason==='bundled'&&
          (typeof record.archive.articleId!=='string'||!/^[a-z0-9][a-z0-9-]*$/.test(record.archive.articleId)||!/^([a-f0-9]{64})$/.test(record.archive.articleRevision))))fail();
        seen.add(card.fingerprint);record.card=card;
      }
      return state;
    }catch(error){if(error.code==='ENOENT')return {schema:1,records:[]};throw error;}
  }
  async writeState(state) {
    if(!this.root)fail();
    await fs.mkdir(this.root,{recursive:true});
    if((await fs.lstat(this.root)).isSymbolicLink())fail();
    const file=path.join(this.root,'findings.json');
    try{if((await fs.lstat(file)).isSymbolicLink())fail();}catch(error){if(error.code!=='ENOENT')throw error;}
    const text=JSON.stringify(state,null,2);if(Buffer.byteLength(text)>MAX_BYTES)fail();
    const temporary=path.join(this.root,`${crypto.randomUUID()}.tmp`);
    try{await fs.writeFile(temporary,text,{encoding:'utf8',flag:'wx'});await fs.rename(temporary,file);}
    finally{await fs.rm(temporary,{force:true});}
    this.generation++;
  }
  async save(input,connection,trace=[]) {return this.mutate(async()=>{
    const card=sanitizeFinding({...input,environment:{archicad:Number(connection?.archicad_version),build:Number(connection?.archicad_build),tapir:connection?.tapir_installed}});
    if(!card||!localMetadata(input)||input.notes!==undefined&&(typeof input.notes!=='string'||input.notes.length>4000))fail();
    const state=await this.readState(),old=state.records.find(record=>record.card.fingerprint===card.fingerprint);
    // An ordered subsequence must have actually run in this task. This is only
    // observed execution, never independent validation of the agent's conclusion.
    let cursor=0;
    const observed=card.steps.every(step=>{
      const index=trace.findIndex((item,i)=>i>=cursor&&item.tool===step.tool&&item.command===step.command&&item.success);
      if(index<0)return false;cursor=index+1;return true;
    });
    if(!old&&state.records.length>=MAX_RECORDS)throw new Error(t('findings.limit'));
    const record=old||{card,notes:'',enabled:true,pinned:false,confidence:'candidate'};
    if(input.title)record.title=input.title.trim();
    if(input.keywords)record.keywords=[...new Set([...(record.keywords||[]),...input.keywords.map(word=>word.trim())])].slice(0,12);
    if(input.notes?.trim()&&record.notes!==input.notes.trim()) {
      const notes=[record.notes,input.notes.trim()].filter(Boolean).join('\n\n');if(notes.length>4000)fail();record.notes=notes;
    }
    if(observed)record.confidence='observed';
    if(!old)state.records.push(record);
    await this.writeState(state);
    return {id:`finding:${card.fingerprint}`,confidence:record.confidence,verification:'unverified',archived:!!record.archive};
  });}
  async reconcile(bundled,covers) {return this.mutate(async()=>{
    const state=await this.readState();let changed=false;
    for(const record of state.records) {
      if(record.archive?.reason==='user')continue;
      const article=!record.pinned&&bundled.find(entry=>entry.enabled&&entry.absorbsFindings?.includes(record.card.fingerprint)&&covers(entry,record.card.environment));
      const archive=article?{reason:'bundled',articleId:article.id,articleRevision:article.revision}:undefined;
      if(JSON.stringify(record.archive)!==JSON.stringify(archive)){record.archive=archive;changed=true;}
    }
    if(changed)await this.writeState(state);
    return state.records.map(record=>this.entry(record));
  });}
  entry(record) {
    const card=record.card,title=record.title||t(`findings.category.${card.category}`),route=card.steps.map(step=>step.command||step.tool).join(' → ');
    const text=[`# ${title}`,t('findings.reference'),`${t('findings.confidence')}: ${t(`findings.${record.confidence}`)}`,
      `Archicad ${card.environment.archicad} / ${card.environment.build} / Tapir ${card.environment.tapir}`,
      ...card.steps.map((step,index)=>`${index+1}. ${step.action}: ${step.tool}${step.command?` / ${step.command}`:''}${step.fields.length?` (${step.fields.join(', ')})`:''}`),
      `${t('findings.checks')}: ${card.checks.join(', ')||'none'}`,`${t('findings.cautions')}: ${card.cautions.join(', ')||'not_independently_verified'}`,record.notes].filter(Boolean).join('\n\n');
    return {id:`finding:${card.fingerprint}`,title,summary:route.slice(0,320),text,source:'agent',scope:'global',kind:'knowledge',activation:record.confidence==='observed'?'auto':'manual',
      enabled:record.enabled&&!record.archive,tags:[...(record.keywords||[]),card.category,...new Set(card.steps.map(step=>step.command||step.tool))].slice(0,20),triggers:[title,...(record.keywords||[]),card.category,...card.steps.flatMap(step=>[step.tool,step.command,...step.fields]).filter(Boolean)],
      archicad:[card.environment.archicad],compatibility:[{archicad:card.environment.archicad,minBuild:card.environment.build,maxBuild:card.environment.build,tapirMin:card.environment.tapir,tapirMax:card.environment.tapir}],
      verifiedOn:[],revision:revision(record),relative:'agent-findings/findings.json',searchText:text.toLocaleLowerCase(),confidence:record.confidence,archived:!!record.archive,archive:record.archive,pinned:record.pinned};
  }
  async update({id,revision:expected,enabled,pinned,archived}) {return this.mutate(async()=>{
    const state=await this.readState(),record=state.records.find(item=>`finding:${item.card.fingerprint}`===id);
    if(!record||revision(record)!==expected)throw new Error(t('knowledge.conflict'));
    if([enabled,pinned,archived].every(value=>value===undefined)||[enabled,pinned,archived].some(value=>value!==undefined&&typeof value!=='boolean'))fail();
    if(enabled!==undefined)record.enabled=enabled;
    if(pinned!==undefined)record.pinned=pinned;
    if(archived===true)record.archive={reason:'user'};
    if(archived===false){delete record.archive;record.pinned=true;}
    await this.writeState(state);return this.entry(record);
  });}
  async pending(installationId,now,limit=20) {return this.mutate(async()=>{
    const state=await this.readState(),pending=[];let changed=false;
    for(const record of state.records) {
      if(!record.enabled||record.archive||record.confidence!=='observed')continue;
      if(record.delivery?.installationId===installationId&&record.delivery.deliveredAt!==undefined&&now-record.delivery.deliveredAt<WEEK)continue;
      if(record.delivery?.installationId!==installationId||record.delivery.deliveredAt!==undefined) {
        record.delivery={installationId,eventId:crypto.randomUUID()};changed=true;
      }
      pending.push({eventId:record.delivery.eventId,card:record.card});if(pending.length>=limit)break;
    }
    if(changed)await this.writeState(state);
    return pending;
  });}
  async delivered(eventIds,installationId,now) {return this.mutate(async()=>{
    const state=await this.readState();let changed=false;
    for(const record of state.records)if(record.delivery?.installationId===installationId&&eventIds.includes(record.delivery.eventId)) {
      record.delivery.deliveredAt=now;changed=true;
    }
    if(changed)await this.writeState(state);
  });}
}

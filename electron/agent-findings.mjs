import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {t} from '../locales/index.mjs';
import {sanitizeFinding,sanitizeFindingEvidence,validFindingComparison} from './finding-schema.mjs';
import {findingEvidence,matchFindingSteps} from './finding-observer.mjs';

const WEEK=7*24*60*60*1000,MAX_RECORDS=1000,MAX_BYTES=8*1024*1024;
const revision=({delivery,shared,...value})=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
      const file=path.join(this.root,'findings.json'),handle=await fs.open(file,'r');
      let state;
      try {
        const stat=await handle.stat(),link=await fs.lstat(file);
        if(link.isSymbolicLink()||!stat.isFile()||stat.size>MAX_BYTES||stat.dev!==link.dev||stat.ino!==link.ino)fail();
        state=JSON.parse(await handle.readFile('utf8'));
      } finally {await handle.close();}
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
        if(record.evidence!==undefined){record.evidence=sanitizeFindingEvidence(record.evidence);if(!record.evidence)fail();}
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
  async save(input,connection,trace=[],{replaceId,failure,checkpoint=false}={}) {return this.mutate(async()=>{
    let card=sanitizeFinding({...input,schema:2,environment:{archicad:Number(connection?.archicad_version),build:Number(connection?.archicad_build),tapir:connection?.tapir_installed}});
    if(!card||!localMetadata(input)||input.notes!==undefined&&(typeof input.notes!=='string'||input.notes.length>4000))fail();
    const state=await this.readState();
    const legacy=!input.condition&&!input.correction&&sanitizeFinding({...input,schema:1,environment:card.environment});
    const existing=state.records.find(record=>record.card.fingerprint===card.fingerprint)||
      (legacy&&state.records.find(record=>record.card.schema===1&&record.card.fingerprint===legacy.fingerprint)),
      previous=replaceId&&state.records.find(record=>`finding:${record.card.fingerprint}`===replaceId),old=existing||previous;
    if(existing?.card?.schema===1)card=existing.card;
    // An ordered subsequence must have actually run in this task. This is only
    // observed execution, never independent validation of the agent's conclusion.
    failure??=input.condition&&[...trace].reverse().find(item=>!item.success&&item.diagnostic?.kind===card.condition?.kind);
    const matched=matchFindingSteps(card.steps,failure?trace.filter(item=>item.index>failure.index):trace),observed=matched.length===card.steps.length;
    const evidence=findingEvidence(trace,matched,failure,card);
    if(!old&&state.records.length>=MAX_RECORDS)throw new Error(t('findings.limit'));
    const record=old||{card,notes:'',enabled:true,pinned:false,confidence:'candidate'};
    const before=JSON.stringify({card:record.card,evidence:record.evidence,confidence:record.confidence,origin:record.origin});
    if(observed||record.confidence!=='observed'||record.card.fingerprint!==card.fingerprint)record.evidence=evidence;
    record.card=card;
    if(checkpoint)record.origin='checkpoint';
    if(input.title)record.title=input.title.trim();
    if(input.keywords)record.keywords=[...new Set([...(record.keywords||[]),...input.keywords.map(word=>word.trim())])].slice(0,12);
    if(input.notes?.trim()&&record.notes!==input.notes.trim()) {
      const notes=[record.notes,input.notes.trim()].filter(Boolean).join('\n\n');if(notes.length>4000)fail();record.notes=notes;
    }
    if(observed)record.confidence='observed';
    if(before!==JSON.stringify({card:record.card,evidence:record.evidence,confidence:record.confidence,origin:record.origin}))delete record.delivery;
    if(previous&&existing&&previous!==existing)state.records=state.records.filter(item=>item!==previous);
    if(!old)state.records.push(record);
    await this.writeState(state);
    return {id:`finding:${card.fingerprint}`,confidence:record.confidence,verification:'unverified',evidence:record.evidence,archived:!!record.archive};
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
  async verify(input,connection,readback,result) {return this.mutate(async()=>{
    if(!validFindingComparison(input)||!readback?.success||!readback.readOnly||readback.command!==input.command)fail();
    const state=await this.readState(),record=state.records.find(item=>`finding:${item.card.fingerprint}`===input.id);
    const environment=record?.card.environment;
    if(!record||record.confidence!=='observed'||record.archive||!record.enabled||environment.archicad!==Number(connection?.archicad_version)||
      environment.build!==Number(connection?.archicad_build)||environment.tapir!==connection?.tapir_installed)fail();
    let actual=result;
    for(const field of input.field_path) {
      if(Array.isArray(actual))actual=actual.length===1?actual[0]:undefined;
      actual=actual&&typeof actual==='object'&&Object.hasOwn(actual,field)?actual[field]:undefined;
    }
    const comparison=actual!==null&&typeof actual==='object'||actual===undefined?'unavailable':Object.is(actual,input.expected)?'matched':'mismatched';
    const previous=record.evidence||{route:[],checks:[]};
    const checks=previous.checks.filter(check=>check.kind!=='expected_value'||JSON.stringify(check.field_path)!==JSON.stringify(input.field_path));
    const check={kind:'expected_value',state:comparison,field_path:input.field_path,observation:readback};
    checks.push(check);
    record.evidence=sanitizeFindingEvidence({...previous,checks});delete record.delivery;
    await this.writeState(state);
    readback.confirmations??=[];
    readback.confirmations.push({fingerprint:record.card.fingerprint,check});
    return {id:input.id,comparison,verification:record.evidence.verification,semantic_result:'unverified'};
  });}
  entry(record) {
    const card=record.card,title=record.title||t(`findings.category.${card.category}`),route=card.steps.map(step=>step.command||step.tool).join(' → ');
    const text=[`# ${title}`,t('findings.reference'),`${t('findings.confidence')}: ${t(`findings.${record.confidence}`)}`,
      `Archicad ${card.environment.archicad} / ${card.environment.build} / Tapir ${card.environment.tapir}`,
      ...card.steps.map((step,index)=>`${index+1}. ${step.action}: ${step.tool}${step.command?` / ${step.command}`:''}${step.fields.length?` (${step.fields.join(', ')})`:''}`),
      ...(card.condition?[`${t('findings.condition')}: ${JSON.stringify(card.condition)}`,`${t('findings.correction')}: ${JSON.stringify(card.correction)}`]:[]),
      `${t('findings.observedChecks')}: ${record.evidence?.checks.map(check=>`${check.kind}: ${check.state}${check.kind==='readback'?' (comparison: not_performed)':''}`).join(', ')||'none'}`,
      `${t('findings.checks')}: ${card.checks.join(', ')||'none'}`,`${t('findings.cautions')}: ${card.cautions.join(', ')||'not_independently_verified'}`,record.notes].filter(Boolean).join('\n\n');
    return {id:`finding:${card.fingerprint}`,title,summary:route.slice(0,320),text,source:'agent',scope:'global',kind:'knowledge',activation:record.confidence==='observed'&&!(record.origin==='checkpoint'&&['unknown','retry_same_shape'].includes(card.correction?.kind))?'auto':'manual',
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
      if(!record.enabled||record.archive||record.confidence!=='observed'||record.evidence?.verification?.status!=='verified'&&!record.shared)continue;
      if(record.delivery?.installationId===installationId&&record.delivery.deliveredAt!==undefined&&now-record.delivery.deliveredAt<WEEK)continue;
      if(record.delivery?.installationId!==installationId||record.delivery.deliveredAt!==undefined) {
        record.delivery={installationId,eventId:crypto.randomUUID()};changed=true;
      }
      pending.push({eventId:record.delivery.eventId,card:record.card,evidence:sanitizeFindingEvidence(record.evidence),confidence:record.confidence,
        disposition:record.evidence?.verification?.status==='verified'?'solution':'withdrawn',origin:record.origin==='checkpoint'?'checkpoint':'agent'});if(pending.length>=limit)break;
    }
    if(changed)await this.writeState(state);
    return pending;
  });}
  async delivered(eventIds,installationId,now) {return this.mutate(async()=>{
    const state=await this.readState();let changed=false;
    for(const record of state.records)if(record.delivery?.installationId===installationId&&eventIds.includes(record.delivery.eventId)) {
      record.delivery.deliveredAt=now;record.shared=true;changed=true;
    }
    if(changed)await this.writeState(state);
  });}
}

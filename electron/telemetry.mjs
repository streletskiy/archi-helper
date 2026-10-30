import crypto from 'node:crypto';
import {appFetch} from './network.mjs';
import {t} from '../locales/index.mjs';
import {TELEMETRY_CONFIG} from './telemetry-config.mjs';
import {sanitizeEvent,providerMetadata,connectionMetadata,publicModel,publicCommand,publicArticles,classifyError,classifyTask} from './telemetry-schema.mjs';
import {withObservation,observationPurpose} from './telemetry-context.mjs';
import {normalizeExecutionResult,toolDiagnostic,sanitizePythonObservation} from './tool-diagnostics.mjs';
import {operationToolNames} from './operation-tools.mjs';

const uuid=()=>crypto.randomUUID();
const validId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0?value:undefined;
const TTL=24*60*60*1000,MAX_QUEUE=1000,MAX_RUNS=5;
const workflowEvent=event=>['archi_workflow_observed','archi_tool_diagnostic','archi_finding_shared'].includes(event);

export class Telemetry {
  constructor(store,{runtimeEnabled=false,version='0.0.0',installationKind='installed',fetcher=appFetch,config=TELEMETRY_CONFIG,environment='production',now=Date.now,findings}={}) {
    Object.assign(this,{store,runtimeEnabled,version,installationKind,fetcher,config,environment,now,findings});
    this.queue=[];this.epoch=0;this.workflowEpoch=0;this.preferences=Promise.resolve();this.lastDelivery='idle';
    this.timer=setInterval(()=>{void this.flush();},15000);this.timer.unref?.();
  }
  async init() {
    const previous=this.store.state.telemetry;
    this.store.state.telemetry={enabled:previous?.enabled!==false,shareWorkflows:previous?.shareWorkflows!==false,
      installationId:validId(previous?.installationId)?previous.installationId:uuid(),
      firstEventId:validId(previous?.firstEventId)?previous.firstEventId:uuid(),
      firstSeenAt:typeof previous?.firstSeenAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(previous.firstSeenAt)?previous.firstSeenAt:new Date(this.now()).toISOString(),
      firstSeenDelivered:previous?.firstSeenDelivered===true,
      existingProfile:previous?.existingProfile??!!(this.store.state.providers?.length||this.store.state.projects?.length)};
    try{await this.store.save();}catch{this.blocked=true;this.lastDelivery='storage_error';}
  }
  get active(){return this.runtimeEnabled&&!!this.config.projectToken&&this.store.state.telemetry?.enabled===true&&!this.blocked;}
  get workflows(){return this.active&&this.store.state.telemetry.shareWorkflows===true;}
  state(){const s=this.store.state.telemetry;return {enabled:s?.enabled!==false,shareWorkflows:s?.shareWorkflows!==false,
    installationId:s?.installationId,active:this.active,development:!this.runtimeEnabled,queued:this.queue.length,delivery:this.lastDelivery};}
  start() {
    if(this.started)return;this.started=true;
    if(this.active){this.firstSeen();this.capture('archi_app_started',{installation_kind:this.installationKind});this.providers();}
  }
  firstSeen() {
    const s=this.store.state.telemetry;
    if(!this.active||s.firstSeenDelivered||this.queue.some(item=>item.event==='archi_first_seen'))return;
    this.capture('archi_first_seen',{installation_kind:this.installationKind,existing_profile:s.existingProfile},{id:s.firstEventId,timestamp:s.firstSeenAt});
  }
  providers() {
    const groups=new Map();
    for(const provider of this.store.state.providers||[]){const meta=providerMetadata(provider),key=JSON.stringify(meta);groups.set(key,(groups.get(key)||0)+1);}
    for(const [key,count] of groups)this.capture('archi_provider_status',{...JSON.parse(key),status:'configured',configured_count:count});
  }
  provider(provider,status){this.capture('archi_provider_status',{...providerMetadata(provider),status});}
  connection(connection){this.capture('archi_connection',{connected:connection?.connected===true,...connectionMetadata(connection?.data)});}
  update(input) {
    if(!input||!Object.keys(input).length||Object.keys(input).some(key=>!['enabled','shareWorkflows'].includes(key))||Object.values(input).some(value=>typeof value!=='boolean'))throw new Error(t('telemetry.invalidSettings'));
    const revision=this.preferenceRevision=(this.preferenceRevision||0)+1;
    const desired=this.desiredPreferences={enabled:this.store.state.telemetry.enabled,shareWorkflows:this.store.state.telemetry.shareWorkflows,...this.desiredPreferences,...input};
    // Apply revocation synchronously, before any disk I/O or a queued preference write.
    if(input.enabled===false){this.store.state.telemetry.enabled=false;this.epoch++;this.workflowEpoch++;this.queue=[];this.controller?.abort();this.lastDelivery='disabled';}
    if(input.shareWorkflows===false){this.store.state.telemetry.shareWorkflows=false;this.workflowEpoch++;this.queue=this.queue.filter(item=>!workflowEvent(item.event));this.controller?.abort();}
    const update=this.preferences.catch(()=>{}).then(async()=>{
      if(revision!==this.preferenceRevision)return this.state();
      const before=this.active;
      Object.assign(this.store.state.telemetry,desired);
      // No capture can resume before the new choice has been durably saved.
      this.blocked=true;
      try{await this.store.save();if(revision!==this.preferenceRevision)return this.state();this.blocked=false;}
      catch{this.store.state.telemetry.enabled=false;if(revision===this.preferenceRevision)this.desiredPreferences={...desired,enabled:false};this.epoch++;this.queue=[];this.controller?.abort();this.lastDelivery='storage_error';throw new Error(t('telemetry.saveFailed'));}
      if(this.active&&!before){this.epoch++;this.firstSeen();this.capture('archi_app_started',{installation_kind:this.installationKind});this.providers();}
      return this.state();
    });
    this.preferences=update;return update;
  }
  capture(event,properties,{id=uuid(),timestamp=new Date(this.now()).toISOString()}={}) {
    if(!this.active||this.closing||workflowEvent(event)&&!this.workflows)return false;
    const safe=sanitizeEvent(event,properties);if(!safe)return false;
    this.queue=this.queue.filter(item=>this.now()-item.queuedAt<TTL);
    if(this.queue.length>=MAX_QUEUE)this.queue.shift();
    this.queue.push({event,uuid:id,timestamp,properties:safe,queuedAt:this.now(),epoch:this.epoch});
    return true;
  }
  async flush() {
    if(this.sending)return this.sending;
    if(!this.active||this.now()<(this.retryAt||0))return;
    this.sending=this.deliver().finally(()=>{this.sending=null;});
    return this.sending;
  }
  async deliver() {
    const pendingEpoch=this.workflowEpoch;
    if(this.workflows&&this.findings&&!this.closing) {
      try {
        const pending=await this.findings.pending(this.store.state.telemetry.installationId,this.now());
        if(this.workflows&&pendingEpoch===this.workflowEpoch) {
          const allowed=new Set(pending.map(item=>item.eventId));
          this.queue=this.queue.filter(item=>item.event!=='archi_finding_shared'||allowed.has(item.uuid));
          for(const item of pending)if(!this.queue.some(event=>event.uuid===item.eventId))this.capture('archi_finding_shared',
            {finding:item.card,evidence:item.evidence,confidence:item.confidence,origin:item.origin,disposition:item.disposition},{id:item.eventId});
        }
      }catch{this.lastDelivery='storage_error';}
    }
    if(!this.active)return;
    this.queue=this.queue.filter(item=>item.epoch===this.epoch&&this.now()-item.queuedAt<TTL&&(!workflowEvent(item.event)||this.workflows));
    if(!this.queue.length)return;
    const epoch=this.epoch,workflowEpoch=this.workflowEpoch,batch=this.queue.splice(0,50),controller=new AbortController();this.controller=controller;
    return (async()=>{
      try {
        const events=batch.map(item=>({event:item.event,uuid:item.uuid,timestamp:item.timestamp,properties:{...sanitizeEvent(item.event,item.properties),
          distinct_id:this.store.state.telemetry.installationId,app:'archi-helper',app_version:this.version,schema_version:this.config.schemaVersion,
          environment:this.environment,platform:process.platform,architecture:process.arch,$geoip_disable:true,$process_person_profile:false,$ip:null,$lib:'archi-helper'}}));
        if(!this.active||epoch!==this.epoch)return;
        const response=await this.fetcher(`${this.config.host}/batch/`,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',redirect:'error',
          signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]),body:JSON.stringify({api_key:this.config.projectToken,batch:events})});
        await response.body?.cancel();
        if(!response.ok){this.lastDelivery='unavailable';if(response.status===429||response.status>=500)throw new Error('Retry delivery');this.retryAt=this.now()+300000;return;}
        if(!this.active||epoch!==this.epoch)return;
        this.lastDelivery='delivered';this.failures=0;this.retryAt=0;
        if(this.workflows&&workflowEpoch===this.workflowEpoch&&this.findings) {
          const ids=batch.filter(item=>item.event==='archi_finding_shared').map(item=>item.uuid);
          if(ids.length)await this.findings.delivered(ids,this.store.state.telemetry.installationId,this.now());
        }
        if(batch.some(item=>item.event==='archi_first_seen')){
          this.store.state.telemetry.firstSeenDelivered=true;
          await this.store.save().catch(()=>{});
        }
      } catch {
        if(this.active&&epoch===this.epoch&&!this.closing){
          this.lastDelivery='unavailable';this.failures=Math.min(5,(this.failures||0)+1);this.retryAt=this.now()+Math.min(300000,15000*2**this.failures);
          this.queue=[...batch.filter(item=>!workflowEvent(item.event)||this.workflows&&workflowEpoch===this.workflowEpoch),...this.queue].slice(-MAX_QUEUE);
        }
      } finally {if(this.controller===controller)this.controller=null;}
    })();
  }
  async shutdown() {
    clearInterval(this.timer);this.closing=true;
    let timeout;await Promise.race([this.flush(),new Promise(resolve=>{timeout=setTimeout(resolve,1500);})]);clearTimeout(timeout);this.controller?.abort();this.queue=[];
  }
  async task(session,input,connection,action) {
    if(!this.active)return action();
    const run=new TaskObservation(this,input,connection);
    return withObservation(run,async()=>{
      let result;
      try{result=await action();return result;}
      catch(error){run.failure(error);throw error;}
      finally {
        const record=run.finish(result);
        if(record){session.telemetryRuns=[...(session.telemetryRuns||[]),record].slice(-MAX_RUNS);await this.store.saveSession(session).catch(()=>{});}
      }
    });
  }
  runs(session){return (session.telemetryRuns||[]).filter(record=>record.installationId===this.store.state.telemetry.installationId).map(record=>({id:record.id,
    summary:sanitizeEvent('archi_task_finished',record.summary),steps:sanitizeEvent('archi_workflow_observed',{steps:record.steps}).steps||[],feedback:record.feedback,
    shared:record.shared===true,coverage:record.coverage,installationId:undefined}));}
  async feedback(session,id,value) {
    if(!['helpful','unhelpful','uncertain'].includes(value))throw new Error(t('telemetry.invalidFeedback'));
    const record=(session.telemetryRuns||[]).find(item=>item.id===id&&item.installationId===this.store.state.telemetry.installationId);
    if(!record)throw new Error(t('telemetry.runUnavailable'));
    if(record.feedback===value)return this.runs(session);
    const previous=record.feedback;record.feedback=value;
    try{await this.store.saveSession(session);}catch(error){record.feedback=previous;throw error;}
    this.capture('archi_task_feedback',{...record.summary,feedback:value});
    return this.runs(session);
  }
}

class TaskObservation {
  constructor(telemetry,input,connection) {
    this.telemetry=telemetry;this.epoch=telemetry.epoch;this.workflowEpoch=telemetry.workflowEpoch;this.started=telemetry.now();this.id=uuid();
    this.collectRoute=telemetry.workflows;this.steps=[];this.failedSteps=new Map();this.knowledge=new Set();this.counts={tool_count:0,tool_errors:0,request_count:0,generation_count:0,generation_errors:0,compaction_count:0,steering_count:0};
    const provider=telemetry.store.state.providers?.find(p=>p.id===input.providerId);
    this.meta={run_id:this.id,...providerMetadata(provider),model:publicModel(input.model),task_kind:input.kind==='direct'?'direct':classifyTask(input.text||''),
      permission_mode:input.mode,...connectionMetadata(connection)};
    telemetry.capture('archi_task_started',this.meta);if(provider)telemetry.provider(provider,'used');
  }
  get active(){return this.telemetry.active&&this.epoch===this.telemetry.epoch;}
  diagnosticReference() {
    if(this.active&&this.collectRoute&&this.telemetry.workflows&&this.workflowEpoch===this.telemetry.workflowEpoch)
      return {run_id:this.id,step_index:this.counts.tool_count};
  }
  emit(event,properties){if(this.active)this.telemetry.capture(event,properties);}
  failure(error,signal){this.error=classifyError(error,signal);}
  steering(count){if(this.active)this.counts.steering_count+=count;}
  knowledgeUsed(ids,activation) {
    if(!this.active)return;
    const fresh=publicArticles(ids).filter(id=>!this.knowledge.has(id));for(const id of fresh)this.knowledge.add(id);
    if(fresh.length)this.emit('archi_knowledge_used',{run_id:this.id,knowledge_ids:fresh,activation});
  }
  generation(provider,model) {
    if(!this.active)return;
    const started=this.telemetry.now(),purpose=observationPurpose(),span=uuid();let usage,first;
    this.counts.generation_count++;if(purpose==='compaction')this.counts.compaction_count++;
    return {delta:()=>{first??=this.telemetry.now();},usage:value=>{usage=value;},end:(error,signal)=>{
      if(error)this.counts.generation_errors++;
      const input=integer(usage?.prompt_tokens??usage?.input_tokens),output=integer(usage?.completion_tokens??usage?.output_tokens);
      this.emit('$ai_generation',{run_id:this.id,$ai_trace_id:this.id,$ai_span_id:span,$ai_provider:providerMetadata(provider).provider_type,$ai_model:publicModel(model),
        $ai_latency:(this.telemetry.now()-started)/1000,...(first!==undefined?{$ai_time_to_first_token:(first-started)/1000}:{}),
        $ai_input_tokens:input,$ai_output_tokens:output,$ai_cache_read_input_tokens:integer(usage?.prompt_tokens_details?.cached_tokens),
        $ai_reasoning_tokens:integer(usage?.completion_tokens_details?.reasoning_tokens),usage_known:input!==undefined&&output!==undefined,
        $ai_is_error:!!error,...(error?{$ai_error:classifyError(error,signal),$ai_http_status:error.status}:{}),purpose});
    }};
  }
  async http(provider,action,signal) {
    const started=this.telemetry.now();if(this.active)this.counts.request_count++;
    try{const response=await action();this.emit('archi_http_request',{run_id:this.id,...providerMetadata(provider),http_status:response.status,duration_ms:this.telemetry.now()-started,purpose:observationPurpose(),error_category:response.ok?'none':classifyError({status:response.status})});return response;}
    catch(error){this.emit('archi_http_request',{run_id:this.id,...providerMetadata(provider),duration_ms:this.telemetry.now()-started,purpose:observationPurpose(),error_category:classifyError(error,signal)});throw error;}
  }
  async tool(name,args,action,signal) {
    const started=this.telemetry.now();let result,error;
    try{result=await action();if(name==='call_archicad')result=normalizeExecutionResult(result);return result;}catch(e){error=e;throw e;}finally {
      if(this.active){
        this.counts.tool_count++;const failed=!!error||result?.isError===true;
        const category=error?classifyError(error,signal):result?.termination==='timeout'?'timeout':result?.termination==='cancelled'?'cancelled':failed?(name==='run_python'?'python_error':'tool_error'):'none';
        const unknown=result?.outcomeUnknown===true||name==='call_archicad'&&(signal?.aborted||category==='timeout');
        if(failed)this.counts.tool_errors++;if(unknown)this.unknown=true;
        const command=name==='call_archicad'?publicCommand(args?.name):'other';
        this.emit('archi_tool_finished',{run_id:this.id,tool:name,command,duration_ms:this.telemetry.now()-started,outcome:unknown?'outcome_unknown':failed?'failed':'completed_unverified',error_category:category,
          ...(result?.operation?{operation_status:result.status,operation_action:args?.action,readback_checked:result.checks?.includes('readback_after_write')===true}:{})});
        if(!failed&&name==='get_knowledge'&&args?.id)this.knowledgeUsed([args.id],'read');
        if(this.collectRoute&&this.telemetry.workflows&&this.workflowEpoch===this.telemetry.workflowEpoch){
          const step_index=this.counts.tool_count,key=`${name}:${command}`,previous_failed_step=this.failedSteps.get(key);
          const diagnostic=['call_archicad','run_python'].includes(name)?toolDiagnostic(name,args,result,error,{failed,unknown}):undefined;
          if(diagnostic)this.emit('archi_tool_diagnostic',{run_id:this.id,tool:name,command,step_index,previous_failed_step,outcome:unknown?'outcome_unknown':failed?'failed':'completed_unverified',error_category:category,diagnostic});
          if(name==='run_python'&&result?.apiObservation)for(const [index,call] of sanitizePythonObservation(result.apiObservation).calls.entries()) {
            const uncertain=call.diagnostic.kind==='unknown_outcome',bad=['execution_failure','python_exception','tool_failure'].includes(call.diagnostic.kind);
            this.emit('archi_tool_diagnostic',{run_id:this.id,tool:name,command:call.command,source:'python_json_api',step_index,api_step_index:index+1,
              outcome:uncertain?'outcome_unknown':bad?'failed':'completed_unverified',error_category:uncertain?'unknown':bad?'tool_error':'none',diagnostic:call.diagnostic});
          }
          if(failed)this.failedSteps.set(key,step_index);else if(!unknown)this.failedSteps.delete(key);
          if(this.steps.length<60)this.steps.push({tool:name,command,status:unknown?'unknown':failed?'error':'done',error_category:category,step_index,previous_failed_step,diagnostic});else this.truncated=true;
        }
      }
    }
  }
  finish(result) {
    if(!this.active)return;
    const outcome=this.unknown?'outcome_unknown':this.error==='cancelled'?'cancelled':this.error||result===false||result?.status==='error'?'failed':'completed_unverified';
    const summary=sanitizeEvent('archi_task_finished',{...this.meta,...this.counts,duration_ms:this.telemetry.now()-this.started,outcome,
      error_category:this.error||'none',knowledge_ids:[...this.knowledge],route_truncated:this.truncated===true});
    this.emit('archi_task_finished',summary);
    const shared=this.collectRoute&&this.telemetry.workflows&&this.workflowEpoch===this.telemetry.workflowEpoch;
    const coverage=this.steps.some(step=>step.tool==='run_python'||operationToolNames.includes(step.tool))?'agent_tools_only':'agent_and_mcp';
    if(shared)this.emit('archi_workflow_observed',{...summary,steps:this.steps,coverage,verification:'unverified'});
    return {id:this.id,installationId:this.telemetry.store.state.telemetry.installationId,appVersion:this.telemetry.version,schemaVersion:this.telemetry.config.schemaVersion,summary,steps:shared?this.steps:[],coverage,shared};
  }
}

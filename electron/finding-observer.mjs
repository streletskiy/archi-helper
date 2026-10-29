import {resultData} from './progress.mjs';
import {sanitizeFindingEvidence} from './finding-schema.mjs';
import {toolDiagnostic,sanitizePythonObservation} from './tool-diagnostics.mjs';
import catalog from './telemetry-catalog.json' with {type:'json'};
import publicFields from './telemetry-diagnostic-fields.json' with {type:'json'};

const commands=new Set(catalog.commands);
const fields=new Set(publicFields),assignmentCommands=new Set(['ModifyMorphs','ModifySlabs','ModifyRoofs']);
export const findingEnvironment=connection=>JSON.stringify([connection?.archicad_version,connection?.archicad_build,connection?.tapir_installed]);
const successful=item=>item.success===true&&item.status!=='unknown';
export function matchFindingSteps(steps,trace) {
  const matched=[];let cursor=trace.length;
  for(const step of [...steps].reverse()) {
    const index=trace.findLastIndex((item,i)=>i<cursor&&item.tool===step.tool&&item.command===step.command&&successful(item));
    if(index<0)return [];
    matched.unshift(trace[index]);cursor=index;
  }
  return matched;
}

export function findingEvidence(trace,matched,failure,card) {
  const checks=[];
  for(const item of [failure,...matched].filter(Boolean))if(item.diagnostic?.result_check==='execution_results')checks.push({kind:'per_item_errors',
    state:item.status==='unknown'?'unknown':item.diagnostic.kind==='execution_failure'?'failure_marker':item.success?'no_failure_marker':'unknown',observation:item});
  for(const changed of matched.filter(item=>item.success&&!item.readOnly&&item.targets?.size&&!item.targets.incomplete)) {
    const readback=trace.findLast(item=>item.index>changed.index&&item.success&&item.readOnly&&item.targets&&!item.targets.incomplete&&
      [...changed.targets].every(target=>item.targets.has(target)));
    if(readback) {
      checks.push({kind:'readback',state:'observed',observation:readback});
      for(const expected of changed.expected||[]) {
        const actual=readback.actual?.find(item=>JSON.stringify(item.path)===JSON.stringify(expected.path));
        checks.push({kind:'field_values',state:!actual?'unavailable':Object.is(expected.value,actual.value)?'matched':'mismatched',field_path:expected.path,observation:readback});
      }
    }
  }
  const correction=card?.correction,accepted=matched.find(item=>item.diagnostic?.kind==='completed');
  if(failure&&accepted&&['unsupported_argument','missing_argument','invalid_value_type'].includes(failure.diagnostic?.kind)&&
    ['add_field','remove_field','change_type'].includes(correction?.kind)&&
    failure.diagnostic.fields.includes(correction.field_path?.at(-1))) {
    const observed=changedField(failure.diagnostic.input_shape,accepted.diagnostic.input_shape);
    if(observed&&JSON.stringify(observed)===JSON.stringify(correction))checks.push({kind:'api_contract',state:'accepted',field_path:observed.field_path,observation:accepted});
  }
  if(correction?.kind==='replace_field'&&correction.replacement_path?.length)for(const item of matched) {
    let shape=item.diagnostic?.response_shape;
    for(const field of correction.replacement_path){if(Array.isArray(shape))shape=shape[0];shape=shape&&typeof shape==='object'?shape[field]:undefined;}
    const type=Array.isArray(shape)?'array':typeof shape==='object'&&shape?'object':shape;
    if(type&&(!correction.value_type||type===correction.value_type)) {
      checks.push({kind:'response_field',state:'present',field_path:correction.replacement_path,observation:item});break;
    }
  }
  for(const item of trace)for(const confirmation of item.confirmations||[])if(confirmation.fingerprint===card?.fingerprint)checks.push(confirmation.check);
  return sanitizeFindingEvidence({route:matched,failure,checks,trace_truncated:trace.truncated===true});
}

// Compare only explicit scalar assignments on one target. Geometry, aggregate
// calculations, multi-target ordering and omitted fields never become "verified".
function scalarFields(value,path=[],output=[]) {
  if(!value||typeof value!=='object'||path.length>5||output.length>=12)return output;
  for(const [field,child] of Object.entries(value)) {
    if(!fields.has(field)||['elementId','guid','id'].includes(field))continue;
    if(child===null||['string','number','boolean'].includes(typeof child))output.push({path:[...path,field],value:child});
    else if(!Array.isArray(child))scalarFields(child,[...path,field],output);
    if(output.length>=12)break;
  }
  return output;
}
function assignment(value) {
  if(!value||typeof value!=='object')return;
  for(const records of Object.values(value))if(Array.isArray(records)&&records.length===1&&records[0]?.elementId)return scalarFields(records[0]);
}

// Only in-memory target matching. Identifiers and argument/result values are never
// stored in findings, hashed into fingerprints or sent with evidence.
function targets(value,output=new Set(),depth=0,budget={left:5000}) {
  if(!value||typeof value!=='object')return output;
  if(--budget.left<0||depth>10||output.size>=128){output.incomplete=true;return output;}
  if(typeof value.elementId?.guid==='string')output.add(value.elementId.guid);
  for(const child of Object.values(value))if(child&&typeof child==='object')targets(child,output,depth+1,budget);
  return output;
}
function changedField(before,after,path=[],depth=0) {
  if(depth>5||!before||!after||typeof before!=='object'||typeof after!=='object')return;
  for(const key of new Set([...Object.keys(before),...Object.keys(after)])) {
    if(key==='[other]'||/^\d+$/.test(key))continue;
    const field_path=[...path,key];
    if(!(key in before))return {kind:'add_field',field_path};
    if(!(key in after))return {kind:'remove_field',field_path};
    if(typeof before[key]==='string'&&typeof after[key]==='string'&&before[key]!==after[key])return {kind:'change_type',field_path,value_type:after[key]};
    const nested=Array.isArray(before[key])&&Array.isArray(after[key])?changedField(before[key][0],after[key][0],field_path,depth+1):changedField(before[key],after[key],field_path,depth+1);
    if(nested)return nested;
  }
}

export class FindingRecorder {
  constructor(findings) {this.findings=findings;this.trace=[];this.pending=new Map();this.recovered=new Map();this.index=0;}
  connection(connection) {
    const environment=findingEnvironment(connection);
    if(this.environment!==environment){this.trace=[];this.pending.clear();this.recovered.clear();this.environment=environment;}
  }
  async record(name,args,result,error,connection,reference,tools=[]) {
    const index=++this.index;
    if(name==='save_finding')return;
    this.connection(connection);
    const unknown=result?.outcomeUnknown===true||['AbortError','TimeoutError'].includes(error?.name);
    const diagnostic=['call_archicad','run_python'].includes(name)?toolDiagnostic(name,args,result,error,{failed:!!error||result?.isError===true,
      unknown}):undefined;
    const command=name==='call_archicad'?String(args?.name).replace(/^archicad:/,''):undefined;
    const api=name==='run_python'&&result?.apiObservation?sanitizePythonObservation(result.apiObservation):undefined;
    const apiFailed=api?.calls.some(call=>call.diagnostic.kind!=='completed'),apiUnknown=api?.truncated||api?.calls.some(call=>call.diagnostic.kind==='unknown_outcome');
    const record={tool:name,...(commands.has(command)?{command}:{}),index,success:!error&&!result?.isError&&!unknown&&!apiFailed&&!apiUnknown,
      status:unknown||apiUnknown?'unknown':error||result?.isError||apiFailed?'error':'done',diagnostic,
      ...(reference?{source:reference}:{}),readOnly:tools.find(tool=>tool.name===command||tool.key===args?.name)?.annotations?.readOnlyHint===true,
      targets:targets(args?.arguments)};
    if(name==='call_archicad'&&record.success)targets(resultData(result),record.targets);
    if(record.success&&record.targets.size===1&&!record.targets.incomplete) {
      if(assignmentCommands.has(command))record.expected=assignment(args?.arguments);
      const details=resultData(result)?.detailsOfElements;
      if(command==='GetDetailsOfElements'&&Array.isArray(details)&&details.length===1)record.actual=scalarFields(details[0]?.details);
    }
    this.trace.push(record);
    if(name==='call_archicad'&&commands.has(command)||name==='run_python'&&!api?.calls.length)await this.checkpoint(record,connection);
    if(api)for(const [offset,call] of api.calls.entries()) {
      const bad=call.diagnostic.kind!=='completed';
      const item={tool:name,command:call.command,index:index+(offset+1)/100,diagnostic:call.diagnostic,
        coverage:api.truncated?'partial':'bounded',
        success:!bad,status:call.diagnostic.kind==='unknown_outcome'?'unknown':bad?'error':'done',
        ...(reference?{source:{...reference,api_step_index:offset+1}}:{}),readOnly:tools.find(tool=>tool.name===call.command)?.annotations?.readOnlyHint===true};
      this.trace.push(item);
      if(commands.has(call.command))await this.checkpoint(item,connection);
    }
    if(this.trace.length>200){this.trace.splice(0,this.trace.length-200);this.trace.truncated=true;}
    // A later read can supply actual readback evidence after a saved recovery.
    if(record.success&&record.readOnly)for(const recovery of this.recovered.values()) {
      if(recovery.matched.targets?.size&&[...recovery.matched.targets].every(target=>record.targets.has(target)))await this.persist(recovery,connection);
    }
  }
  async persist(state,connection) {
    const saved=await this.findings.save(state.input,connection,this.trace,{replaceId:state.id,failure:state.failure,checkpoint:true});
    state.id=saved.id;
  }
  async checkpoint(item,connection) {
    if(!connection?.archicad_version||!connection?.archicad_build||!connection?.tapir_installed)return;
    const key=`${item.tool}:${item.command||''}`;
    if(item.status!=='done') {
      const kind=item.diagnostic?.kind||'tool_failure';
      const state={failure:item,input:{category:['unsupported_argument','missing_argument','missing_key','invalid_value_type'].includes(kind)?kind:'api_workflow',
        steps:[{tool:item.tool,...(item.command?{command:item.command}:{}),action:item.readOnly?'read':'modify',fields:item.diagnostic?.fields||[]}],
        checks:[],cautions:['not_independently_verified','read_before_retry',...(item.status==='unknown'?['unknown_after_timeout']:[])],
        condition:item.diagnostic,correction:{kind:'unknown'}}};
      state.id=this.pending.get(key)?.id;
      await this.persist(state,connection);this.pending.set(key,state);
      if(this.pending.size>16)this.pending.delete(this.pending.keys().next().value);
      return;
    }
    const state=this.pending.get(key);
    // A successful later call cannot settle an interrupted mutation's outcome.
    if(!state||state.failure.status==='unknown')return;
    state.input.correction=changedField(state.failure.diagnostic?.input_shape,item.diagnostic?.input_shape)||{kind:'retry_same_shape'};
    state.matched=item;
    await this.persist(state,connection);
    this.pending.delete(key);this.recovered.set(key,state);
    if(this.recovered.size>16)this.recovered.delete(this.recovered.keys().next().value);
  }
}

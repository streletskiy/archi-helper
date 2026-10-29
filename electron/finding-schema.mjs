import crypto from 'node:crypto';
import catalog from './telemetry-catalog.json' with {type:'json'};
import publicFields from './telemetry-diagnostic-fields.json' with {type:'json'};
import {sanitizeDiagnostic} from './tool-diagnostics.mjs';

export const FINDING_CATEGORIES=['api_workflow','unsupported_argument','missing_argument','missing_key','invalid_value_type','version_compatibility','verification','dependency','format_handling'];
export const FINDING_ACTIONS=['inspect_schema','read','modify','verify','transform','retry','use_field','avoid_field'];
export const FINDING_CHECKS=['schema','readback','per_item_errors','synthetic','manual','none'];
export const FINDING_CAUTIONS=['check_live_schema','version_specific','explicit_approval','unknown_after_timeout','partial_failure','read_before_retry','synthetic_only','not_independently_verified'];
const tools=new Set(['get_api_catalog','find_tools','call_archicad','run_python','read_file','write_file','view_image','export_layouts_pdf']);
const commands=new Set(catalog.commands),fields=new Set(publicFields);
const list=(value,allowed,max)=>Array.isArray(value)&&value.length<=max&&value.every(item=>allowed.has(item));
const unique=value=>[...new Set(value)].sort();
const version=value=>typeof value==='string'&&/^\d{1,3}(?:\.\d{1,6}){0,3}$/.test(value);
export const FINDING_CORRECTIONS=['unknown','add_field','remove_field','replace_field','change_type','change_command','inspect_schema','read_before_retry','retry_same_shape'];
const primitiveTypes=['string','number','integer','boolean','object','array','null'];
const pathSchema={type:'array',maxItems:6,items:{type:'string'},description:'Ordered public schema field names only. No indices, values or user-defined keys.'};
export function validFindingComparison(input) {
  return !!input&&/^finding:[a-f0-9]{64}$/.test(input.id)&&commands.has(input.command)&&list(input.field_path,fields,6)&&input.field_path.length>0&&
    (input.expected===null||typeof input.expected==='boolean'||typeof input.expected==='number'&&Number.isFinite(input.expected)||typeof input.expected==='string'&&input.expected.length<=4000);
}
export const findingVerificationTool={type:'function',function:{name:'verify_finding',description:'Check a saved finding on this device before sharing it. Performs a fresh discovered read-only Get/Is command and compares one public response field against the expected scalar locally. Arrays along the field path must each contain one item: use a focused read. Only paths, comparison outcome and diagnostic references are shared; values and arguments remain private. This verifies the reported expectation, not the entire user goal or geometry. Never mutate or replay operations just to produce evidence.',parameters:{type:'object',additionalProperties:false,properties:{
  id:{type:'string',description:'Finding ID returned by save_finding.'},command:{type:'string',description:'Exact public name of a discovered read-only Get/Is command.'},arguments:{type:'object',additionalProperties:true,description:'Actual read arguments. Local only.'},field_path:pathSchema,
  expected:{type:['string','number','boolean','null'],description:'Expected scalar from the task or procedure. Compared locally; never stored in the finding or sent to telemetry.'}
},required:['id','command','arguments','field_path','expected']}}};
function rule(value,condition=false) {
  if(!value||typeof value!=='object')return;
  const diagnostic=condition&&sanitizeDiagnostic({...value,result_check:'unknown'});
  if(condition?!diagnostic:!FINDING_CORRECTIONS.includes(value.kind))return;
  const result={kind:condition?diagnostic.kind:value.kind};
  for(const key of ['field_path','replacement_path'])if(value[key]!==undefined) {
    if(!list(value[key],fields,6))return;
    result[key]=[...value[key]];
  }
  if(condition)for(const key of ['fields','expected_type','exception_type','api_error'])if(diagnostic[key]!==undefined)result[key]=diagnostic[key];
  if(!condition&&value.value_type!==undefined){if(!primitiveTypes.includes(value.value_type))return;result.value_type=value.value_type;}
  return result;
}

// Evidence is separate from recipe identity. References are random telemetry run IDs,
// never project/session IDs. Rebuild this object again before every transmission.
export function sanitizeFindingEvidence(input) {
  if(!input||typeof input!=='object')return;
  const reference=value=>{
    if(!value||!(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/).test(value.run_id)||
      !Number.isSafeInteger(value.step_index)||value.step_index<1||value.step_index>1e6)return;
    if(value.api_step_index!==undefined&&(!Number.isSafeInteger(value.api_step_index)||value.api_step_index<1||value.api_step_index>40))return;
    return {run_id:value.run_id,step_index:value.step_index,...(value.api_step_index?{api_step_index:value.api_step_index}:{} )};
  };
  const observation=value=>{
    if(!value||!tools.has(value.tool)||!['done','error','unknown'].includes(value.status)||value.command!==undefined&&!commands.has(value.command))return;
    const diagnostic=sanitizeDiagnostic(value.diagnostic),source=reference(value.source);
    return {tool:value.tool,...(value.command?{command:value.command}:{}),status:value.status,coverage:value.coverage==='partial'?'partial':'bounded',...(source?{source}:{}),...(diagnostic?{diagnostic}:{})};
  };
  const route=(Array.isArray(input.route)?input.route:[]).slice(0,16).map(observation).filter(Boolean);
  const suppliedChecks=Array.isArray(input.checks)?input.checks:[];
  const priority=value=>value?.state==='mismatched'?0:value?.state==='unavailable'?1:value?.kind==='expected_value'?2:3;
  const checks=[...suppliedChecks].sort((a,b)=>priority(a)-priority(b)).slice(0,16).flatMap(value=>{
    const source=observation(value?.observation);
    if(!source)return [];
    if(value.kind==='per_item_errors'&&['no_failure_marker','failure_marker','unknown'].includes(value.state))return [{kind:value.kind,state:value.state,observation:source}];
    if(value.kind==='readback'&&value.state==='observed')return [{kind:value.kind,state:'observed',comparison:'not_performed',observation:source}];
    if(value.kind==='expected_value'&&list(value.field_path,fields,6)&&value.field_path.length&&['matched','mismatched','unavailable'].includes(value.state))
      return [{kind:value.kind,state:value.state,field_path:[...value.field_path],expectation_source:'agent',observation:source}];
    if(list(value.field_path,fields,6)&&value.field_path.length&&
      (value.kind==='field_values'&&['matched','mismatched','unavailable'].includes(value.state)||value.kind==='api_contract'&&value.state==='accepted'||value.kind==='response_field'&&value.state==='present'))
      return [{kind:value.kind,state:value.state,field_path:[...value.field_path],observation:source}];
    return [];
  });
  const failure=observation(input.failure);
  const observations=[...route,...(failure?[failure]:[]),...checks.map(check=>check.observation)];
  const linked=observations.filter(item=>item.source).length;
  const scopes=[...new Set(checks.filter(check=>['matched','accepted','present'].includes(check.state)).map(check=>
    check.kind==='field_values'?'single_target_fields':check.kind==='expected_value'?'reported_expectation':check.kind==='api_contract'?'call_contract':'response_contract'))];
  const status=checks.some(check=>check.state==='mismatched')?'failed':checks.some(check=>check.state==='unavailable')?'unverified':scopes.length?'verified':'unverified';
  return {schema:1,route,...(failure?{failure}:{}),checks,checks_truncated:input.checks_truncated===true||suppliedChecks.length>16,trace_truncated:input.trace_truncated===true,
    diagnostic_linkage:linked===0?'unavailable':linked===observations.length?'linked':'partial',
    verification:{status,scopes},semantic_result:'unverified'};
}

// Rebuild the entire shareable card from public vocabulary at EVERY boundary.
// Never hash, redact or transmit caller-supplied prose, values, code or identifiers.
export function sanitizeFinding(input) {
  if(!input||!FINDING_CATEGORIES.includes(input.category)||!Array.isArray(input.steps)||!input.steps.length||input.steps.length>16)return;
  const environment=input.environment;
  if(!environment||!Number.isInteger(environment.archicad)||environment.archicad<20||environment.archicad>99||
    !Number.isInteger(environment.build)||environment.build<1||environment.build>999999||!version(environment.tapir))return;
  const steps=[];
  for(const step of input.steps) {
    if(!step||!tools.has(step.tool)||!FINDING_ACTIONS.includes(step.action)||
      step.command!==undefined&&!commands.has(step.command)||step.tool==='call_archicad'&&!step.command||
      !list(step.fields??[],fields,12))return;
    steps.push({tool:step.tool,action:step.action,...(step.command?{command:step.command}:{}),fields:unique(step.fields??[])});
  }
  if(!list(input.checks,new Set(FINDING_CHECKS),6)||!list(input.cautions??[],new Set(FINDING_CAUTIONS),8))return;
  const card={schema:1,category:input.category,environment:{archicad:environment.archicad,build:environment.build,tapir:environment.tapir},steps,
    checks:unique(input.checks),cautions:unique(input.cautions??[])};
  if(input.schema===2||input.condition!==undefined||input.correction!==undefined) {
    const condition=rule(input.condition??{kind:'completed'},true),correction=rule(input.correction??{kind:'unknown'});
    if(!condition||!correction)return;
    Object.assign(card,{schema:2,condition,correction});
  }
  return {...card,fingerprint:crypto.createHash('sha256').update(JSON.stringify(card)).digest('hex')};
}

export const findingTool={type:'function',function:{name:'save_finding',description:'Checkpoint a reusable technical finding immediately when discovered, before another long operation or final answer. Update after recovery or readback. Describe the error condition and correction using public schema vocabulary. Never include project data, names, paths, GUIDs, counts, dates, raw output or code. Evidence is attached by the host; checks are only your claims. Only the structured public recipe can be shared; notes stay local. Do not repeat existing knowledge.',parameters:{type:'object',additionalProperties:false,properties:{
  category:{type:'string',enum:FINDING_CATEGORIES},
  condition:{type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:['completed','execution_failure','unsupported_argument','missing_argument','missing_key','invalid_value_type','python_exception','tool_failure','unknown_outcome']},field_path:pathSchema,expected_type:{type:'string',enum:primitiveTypes}},required:['kind']},
  correction:{type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:FINDING_CORRECTIONS},field_path:pathSchema,replacement_path:pathSchema,value_type:{type:'string',enum:primitiveTypes}},required:['kind']},
  steps:{type:'array',minItems:1,maxItems:16,items:{type:'object',additionalProperties:false,properties:{tool:{type:'string',enum:[...tools]},action:{type:'string',enum:FINDING_ACTIONS},command:{type:'string',description:'Exact public command name from the supplied API catalog, without archicad: prefix. Required for call_archicad.'},fields:{type:'array',maxItems:12,items:{type:'string'},description:'Only public API schema field names, never values or user-defined properties.'}},required:['tool','action']}},
  checks:{type:'array',maxItems:6,items:{type:'string',enum:FINDING_CHECKS}},
  cautions:{type:'array',maxItems:8,items:{type:'string',enum:FINDING_CAUTIONS}},
  title:{type:'string',maxLength:120,description:'Local title describing the reusable problem in the user language. Never shared.'},
  keywords:{type:'array',maxItems:12,items:{type:'string',maxLength:40},description:'Local task keywords in the user language and English for automatic retrieval. Never shared.'},
  notes:{type:'string',maxLength:4000,description:'Optional generalized explanation, conditions, solution and limits in the user language. Local only; no private project context or instructions overriding application rules.'}
},required:['category','steps','checks','condition','correction']}}};

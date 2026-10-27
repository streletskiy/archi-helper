import catalog from './telemetry-catalog.json' with {type:'json'};
import taskPatterns from '../locales/telemetry-patterns.json' with {type:'json'};
import {providerDefinition} from './provider-definitions.mjs';

const taskMatchers=Object.entries(taskPatterns).map(([kind,pattern])=>[kind,new RegExp(pattern,'i')]);

const oneOf=values=>value=>values.includes(value)?value:undefined;
const number=(max=1e10)=>value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=max?value:undefined;
const integer=(max=1e10)=>value=>Number.isSafeInteger(value)?number(max)(value):undefined;
const positiveInteger=max=>value=>value>0?integer(max)(value):undefined;
const boolean=value=>typeof value==='boolean'?value:undefined;
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)?value:undefined;
const version=value=>typeof value==='string'&&/^\d{1,3}(?:\.\d{1,6}){0,3}$/.test(value)?value:undefined;
const members=values=>{const set=new Set(values);return value=>set.has(value)?value:undefined;};
const models=members(catalog.models),commands=members(catalog.commands),articles=members(catalog.articles);
export const TOOL_NAMES=['get_knowledge','get_api_catalog','find_tools','call_archicad','export_layouts_pdf','list_files','read_file','write_file','view_image','show_image','run_python'];
export const OUTCOMES=['completed_unverified','failed','cancelled','outcome_unknown'];
export const ERROR_CATEGORIES=['none','cancelled','timeout','permission_denied','authentication','rate_limit','context_limit','invalid_response','network','provider_error','python_error','tool_error','unknown'];
const outcome=oneOf(OUTCOMES),errorCategory=oneOf(ERROR_CATEGORIES),tool=oneOf(TOOL_NAMES);
const taskKind=oneOf(['general','layouts_pdf','schedules','properties','geometry','python','direct']);
const providerType=oneOf(['openai','chatgpt','lumv','deepseek','openrouter','local','custom']);
const feedback=oneOf(['helpful','unhelpful','uncertain']);
const strings=(check,max=20)=>value=>Array.isArray(value)?[...new Set(value.map(check).filter(v=>v!==undefined))].slice(0,max):undefined;
const steps=value=>Array.isArray(value)?value.slice(0,60).flatMap(step=>{
  if(!step||!tool(step.tool))return [];
  return [{tool:step.tool,command:commands(step.command)||'other',status:oneOf(['done','error','unknown'])(step.status)||'unknown',error_category:errorCategory(step.error_category)||'unknown'}];
}):undefined;
const common={run_id:uuid,provider_type:providerType,auth_mode:oneOf(['api_key','oauth','local']),model:value=>models(value)||'custom',
  task_kind:taskKind,permission_mode:oneOf(['read','review','full']),archicad_version:positiveInteger(99),archicad_build:positiveInteger(999999),tapir_version:version,
  duration_ms:number(86400000),outcome,error_category:errorCategory,tool_count:integer(),tool_errors:integer(),request_count:integer(),generation_count:integer(),
  generation_errors:integer(),compaction_count:integer(),steering_count:integer(),knowledge_ids:strings(articles),route_truncated:boolean};
export const EVENT_SCHEMAS=Object.freeze({
  archi_first_seen:{installation_kind:oneOf(['installed','portable']),existing_profile:boolean},
  archi_app_started:{installation_kind:oneOf(['installed','portable'])},
  archi_provider_status:{provider_type:providerType,auth_mode:common.auth_mode,status:oneOf(['configured','verified','removed','used']),configured_count:integer(1000)},
  archi_connection:{connected:boolean,archicad_version:common.archicad_version,archicad_build:common.archicad_build,tapir_version:version},
  archi_task_started:common,
  archi_task_finished:common,
  archi_tool_finished:{run_id:uuid,tool,command:value=>commands(value)||'other',duration_ms:common.duration_ms,outcome,error_category:errorCategory},
  archi_http_request:{run_id:uuid,provider_type:providerType,http_status:integer(599),duration_ms:common.duration_ms,purpose:oneOf(['agent','compaction']),error_category:errorCategory},
  archi_knowledge_used:{run_id:uuid,knowledge_ids:strings(articles),activation:oneOf(['automatic','selected','read'])},
  archi_task_feedback:{...common,feedback},
  archi_workflow_observed:{...common,steps,coverage:oneOf(['agent_tools_only','agent_and_mcp']),verification:oneOf(['unverified'])},
  $ai_generation:{run_id:uuid,'$ai_trace_id':uuid,'$ai_span_id':uuid,'$ai_model':value=>models(value)||'custom','$ai_provider':providerType,
    '$ai_latency':number(86400),'$ai_time_to_first_token':number(86400),'$ai_input_tokens':integer(),'$ai_output_tokens':integer(),
    '$ai_cache_read_input_tokens':integer(),'$ai_reasoning_tokens':integer(),'$ai_is_error':boolean,'$ai_error':errorCategory,
    '$ai_http_status':integer(599),usage_known:boolean,purpose:oneOf(['agent','compaction'])},
});
export function sanitizeEvent(event,properties) {
  const schema=EVENT_SCHEMAS[event];if(!schema||!properties||typeof properties!=='object')return null;
  const result={};
  for(const [key,check] of Object.entries(schema)){const value=check(properties[key]);if(value!==undefined)result[key]=value;}
  return result;
}
export function providerMetadata(provider) {
  const definition=providerDefinition(provider);let local=false;
  try{local=['localhost','127.0.0.1','[::1]'].includes(new URL(provider?.baseURL).hostname);}catch{}
  return {provider_type:providerType(definition?.id)||(local?'local':'custom'),auth_mode:provider?.oauth?'oauth':local?'local':'api_key'};
}
export const publicModel=value=>models(value)||'custom';
export const publicCommand=value=>commands(typeof value==='string'?value.replace(/^archicad:/,''):value)||'other';
export const publicArticles=values=>strings(articles)(values)||[];
export function connectionMetadata(connection) {
  return sanitizeEvent('archi_connection',{archicad_version:Number(connection?.archicad_version),archicad_build:Number(connection?.archicad_build),tapir_version:connection?.tapir_installed});
}
export function classifyError(error,signal) {
  if(signal?.aborted||error?.name==='AbortError')return error?.name==='TimeoutError'||signal?.reason?.name==='TimeoutError'?'timeout':'cancelled';
  if(error?.telemetryCategory&&ERROR_CATEGORIES.includes(error.telemetryCategory))return error.telemetryCategory;
  if(error?.name==='TimeoutError'||error?.code===-32001)return 'timeout';
  if(error?.contextOverflow)return 'context_limit';
  if(error?.retryableResponse||error instanceof SyntaxError)return 'invalid_response';
  if([401,403].includes(error?.status))return 'authentication';
  if(error?.status===429)return 'rate_limit';
  if(error?.status>=400)return 'provider_error';
  if(error instanceof TypeError||['ECONNRESET','ECONNREFUSED','ENOTFOUND','ETIMEDOUT'].includes(error?.cause?.code||error?.code))return 'network';
  return 'unknown';
}
export function classifyTask(text) {
  return taskMatchers.find(([,pattern])=>pattern.test(text))?.[0]||'general';
}

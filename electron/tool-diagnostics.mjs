import fields from './telemetry-diagnostic-fields.json' with {type:'json'};
import {resultData} from './progress.mjs';

const publicFields=new Set(fields);
const kinds=new Set(['completed','execution_failure','unsupported_argument','missing_argument','missing_key','invalid_value_type','python_exception','tool_failure','unknown_outcome']);
const types=new Set(['string','number','integer','boolean','object','array','null']);
const exceptions=new Set(['KeyError','TypeError','ValueError','NameError','AttributeError','IndexError','ImportError','ModuleNotFoundError','SyntaxError','RuntimeError','TimeoutError','OSError']);
const checks=new Set(['execution_results','python_exit','tool_response','unknown']);
const safeField=value=>typeof value==='string'&&publicFields.has(value);
const failure=value=>value&&typeof value==='object'&&(value.success===false||!!value.error);

export function executionResults(result) {
  const data=resultData(result);
  return Array.isArray(data?.executionResults)?data.executionResults:typeof data?.success==='boolean'?[data]:[];
}

export function normalizeExecutionResult(result) {
  if(result?.isError||!executionResults(result).some(failure))return result;
  return {...result,isError:true,error:'Archicad reported a failed execution result. Inspect each executionResults entry before retrying.'};
}

// Retain public schema keys and primitive types, never values, array sizes or arbitrary keys.
function shape(value,depth=0,budget={left:160}) {
  if(--budget.left<0)return 'object';
  if(value===null)return 'null';
  if(typeof value!=='object')return types.has(typeof value)?typeof value:'null';
  if(depth>=5)return 'object';
  if(Array.isArray(value))return value.length?[shape(value[0],depth+1,budget)]:[];
  if(typeof value==='object') {
    const entries=Object.entries(value).slice(0,24),safe=entries.filter(([key])=>safeField(key)).map(([key,item])=>[key,shape(item,depth+1,budget)]);
    if(safe.length<entries.length)safe.push(['[other]','object']);
    return Object.fromEntries(safe);
  }
  return types.has(typeof value)?typeof value:'null';
}

function cleanShape(value,depth=0,budget={left:160}) {
  if(--budget.left<0)return 'object';
  if(typeof value==='string')return types.has(value)?value:'object';
  if(depth>=5)return 'object';
  if(Array.isArray(value))return value.length?[cleanShape(value[0],depth+1,budget)]:[];
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>safeField(key)||key==='[other]').slice(0,24).map(([key,item])=>[key,cleanShape(item,depth+1,budget)]));
  return 'object';
}

function message(d) {
  const names=d.fields.length?` Public schema fields: ${d.fields.join(', ')}.`:'';
  switch(d.kind) {
    case 'unsupported_argument':return `The command rejected unsupported argument fields.${names} Read its exact input schema before retrying.`;
    case 'missing_argument':return `The command is missing a required argument.${names} Read its exact input schema before retrying.`;
    case 'missing_key':return `Python could not find a dictionary key.${names} Decode the MCP envelope and inspect the actual response schema.`;
    case 'invalid_value_type':return `The API rejected a value type${d.expected_type?`; expected ${d.expected_type}`:''}. Read the parameter definition and use the required type.`;
    case 'python_exception':return `Python raised ${d.exception_type||'an exception'}. Raw messages and program output were not collected.`;
    case 'execution_failure':return 'The API reported at least one failed execution result. Check individual results and read back state before retrying changes.';
    case 'unknown_outcome':return 'Execution was interrupted or its outcome is unknown. Inspect state before repeating a mutation.';
    case 'completed':return d.result_check==='execution_results'?'Execution results were inspected and no failure marker was found. Semantic correctness has not been independently verified.':'The tool returned without a failure marker. Semantic correctness has not been independently verified.';
    default:return 'The tool reported a failure. Its raw message was not collected; inspect the local result for details.';
  }
}

// Reconstruct text at every serialization boundary. Caller-supplied prose cannot pass through.
export function sanitizeDiagnostic(value) {
  if(!value||typeof value!=='object'||!kinds.has(value.kind))return undefined;
  const result={kind:value.kind,fields:[...new Set(Array.isArray(value.fields)?value.fields.filter(safeField):[])].slice(0,8),
    result_check:checks.has(value.result_check)?value.result_check:'unknown',verification:'unverified'};
  if(types.has(value.expected_type))result.expected_type=value.expected_type;
  if(exceptions.has(value.exception_type))result.exception_type=value.exception_type;
  if(value.input_shape!==undefined)result.input_shape=cleanShape(value.input_shape);
  if(value.response_shape!==undefined)result.response_shape=cleanShape(value.response_shape);
  result.message=message(result);
  return result;
}

export function toolDiagnostic(name,args,result,error,{failed=false,unknown=false}={}) {
  const data=resultData(result),entries=executionResults(result),bad=entries.filter(failure);
  const strings=[error?.message,result?.error,typeof data==='string'?data:undefined,...bad.slice(0,4).map(item=>item.error?.message)];
  const text=strings.filter(item=>typeof item==='string').map(item=>item.slice(0,4096)).join('\n');
  const diagnostic={kind:unknown?'unknown_outcome':failed?'tool_failure':'completed',fields:[],
    result_check:entries.length?'execution_results':name==='run_python'?'python_exit':'tool_response'};
  if(bad.length&&!unknown)diagnostic.kind='execution_failure';
  if(failed&&!unknown) {
    if(/Additional properties are not allowed/i.test(text))diagnostic.kind='unsupported_argument';
    else if(/is a required property/i.test(text))diagnostic.kind='missing_argument';
    else if(/KeyError:/.test(text))diagnostic.kind='missing_key';
    const expected=text.match(/(?:not an? |not of type ['"]?)(integer|number|string|boolean|object|array)\b/i)?.[1]?.toLowerCase();
    if(expected){diagnostic.kind='invalid_value_type';diagnostic.expected_type=expected;}
    const exception=text.match(/\b([A-Za-z]+Error):/)?.[1];
    if(exceptions.has(exception)){diagnostic.exception_type=exception;if(diagnostic.kind==='tool_failure')diagnostic.kind='python_exception';}
    diagnostic.fields=[...text.matchAll(/['"]([A-Za-z_$][A-Za-z0-9_$]*)['"]/g)].map(match=>match[1]).filter(safeField);
  }
  if(name==='call_archicad')diagnostic.input_shape=shape(args?.arguments||{});
  if(data!==undefined)diagnostic.response_shape=shape(data);
  return sanitizeDiagnostic(diagnostic);
}

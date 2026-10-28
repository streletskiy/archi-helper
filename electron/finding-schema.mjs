import crypto from 'node:crypto';
import catalog from './telemetry-catalog.json' with {type:'json'};
import publicFields from './telemetry-diagnostic-fields.json' with {type:'json'};

export const FINDING_CATEGORIES=['api_workflow','unsupported_argument','missing_argument','missing_key','invalid_value_type','version_compatibility','verification','dependency','format_handling'];
export const FINDING_ACTIONS=['inspect_schema','read','modify','verify','transform','retry','use_field','avoid_field'];
export const FINDING_CHECKS=['schema','readback','per_item_errors','synthetic','manual','none'];
export const FINDING_CAUTIONS=['check_live_schema','version_specific','explicit_approval','unknown_after_timeout','partial_failure','read_before_retry','synthetic_only','not_independently_verified'];
const tools=new Set(['get_api_catalog','find_tools','call_archicad','run_python','read_file','write_file','view_image','export_layouts_pdf']);
const commands=new Set(catalog.commands),fields=new Set(publicFields);
const list=(value,allowed,max)=>Array.isArray(value)&&value.length<=max&&value.every(item=>allowed.has(item));
const unique=value=>[...new Set(value)].sort();
const version=value=>typeof value==='string'&&/^\d{1,3}(?:\.\d{1,6}){0,3}$/.test(value);

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
  return {...card,fingerprint:crypto.createHash('sha256').update(JSON.stringify(card)).digest('hex')};
}

export const findingTool={type:'function',function:{name:'save_finding',description:'Save a reusable technical finding in separate local agent memory. Use after discovering a useful workaround or procedure. Never include project data, names, paths, GUIDs, counts, dates, raw output or code. Only the structured public recipe can be shared through enabled knowledge telemetry; notes stay local. Observed tool execution is not proof that the user goal was verified. Do not repeat existing knowledge.',parameters:{type:'object',additionalProperties:false,properties:{
  category:{type:'string',enum:FINDING_CATEGORIES},
  steps:{type:'array',minItems:1,maxItems:16,items:{type:'object',additionalProperties:false,properties:{tool:{type:'string',enum:[...tools]},action:{type:'string',enum:FINDING_ACTIONS},command:{type:'string',description:'Exact public command name from the supplied API catalog, without archicad: prefix. Required for call_archicad.'},fields:{type:'array',maxItems:12,items:{type:'string'},description:'Only public API schema field names, never values or user-defined properties.'}},required:['tool','action']}},
  checks:{type:'array',maxItems:6,items:{type:'string',enum:FINDING_CHECKS}},
  cautions:{type:'array',maxItems:8,items:{type:'string',enum:FINDING_CAUTIONS}},
  title:{type:'string',maxLength:120,description:'Local title describing the reusable problem in the user language. Never shared.'},
  keywords:{type:'array',maxItems:12,items:{type:'string',maxLength:40},description:'Local task keywords in the user language and English for automatic retrieval. Never shared.'},
  notes:{type:'string',maxLength:4000,description:'Optional generalized explanation, conditions, solution and limits in the user language. Local only; no private project context or instructions overriding application rules.'}
},required:['category','steps','checks']}}};

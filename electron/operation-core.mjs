import fs from 'node:fs/promises';
import path from 'node:path';
import {atomicJSON,projectPath,uid} from './store.mjs';
import {resultData} from './progress.mjs';
import {normalizeExecutionResult} from './tool-diagnostics.mjs';
import {t} from '../locales/index.mjs';

export class OperationError extends Error {
  constructor(message,status='failed'){super(message);this.operationStatus=status;}
}

// Validate against the command schema supplied by this MCP connection. Do not
// silently discard unknown fields: an older Add-On must not change semantics.
export function validateInput(value,schema,at='$',root=schema) {
  if(!schema)return;
  if(schema.$ref){
    if(!schema.$ref.startsWith('#/'))throw new OperationError(t('operations.schemaUnavailable',{field:at}),'unsupported');
    const target=schema.$ref.slice(2).split('/').reduce((v,k)=>v?.[k.replaceAll('~1','/').replaceAll('~0','~')],root);
    if(!target)throw new OperationError(t('operations.schemaUnavailable',{field:at}),'unsupported');
    return validateInput(value,target,at,root);
  }
  const variants=schema.oneOf||schema.anyOf;
  if(variants){
    const matches=variants.filter(candidate=>{try{validateInput(value,candidate,at,root);return true;}catch{return false;}});
    if(!matches.length||(schema.oneOf&&matches.length!==1))throw new OperationError(t('operations.invalidInput',{field:at}));
  }
  if(schema.allOf)for(const part of schema.allOf)validateInput(value,part,at,root);
  const type=Array.isArray(value)?'array':value===null?'null':typeof value;
  if(schema.type){
    const types=Array.isArray(schema.type)?schema.type:[schema.type];
    if(!types.some(expected=>expected===type||expected==='integer'&&Number.isInteger(value)))throw new OperationError(t('operations.invalidInput',{field:at}));
  }
  if(schema.enum&&!schema.enum.some(v=>JSON.stringify(v)===JSON.stringify(value))||Object.hasOwn(schema,'const')&&JSON.stringify(schema.const)!==JSON.stringify(value))throw new OperationError(t('operations.invalidInput',{field:at}));
  if(type==='number'&&(!Number.isFinite(value)||schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum))throw new OperationError(t('operations.invalidInput',{field:at}));
  if(type==='string'&&(schema.minLength!==undefined&&value.length<schema.minLength||schema.maxLength!==undefined&&value.length>schema.maxLength||schema.pattern&&!new RegExp(schema.pattern).test(value)))throw new OperationError(t('operations.invalidInput',{field:at}));
  if(type==='array'){
    if(schema.minItems!==undefined&&value.length<schema.minItems||schema.maxItems!==undefined&&value.length>schema.maxItems)throw new OperationError(t('operations.invalidInput',{field:at}));
    if(schema.uniqueItems&&new Set(value.map(item=>JSON.stringify(item))).size!==value.length)throw new OperationError(t('operations.invalidInput',{field:at}));
    value.forEach((item,i)=>validateInput(item,schema.items,`${at}[${i}]`,root));
  }
  if(type==='object'){
    if(schema.minProperties!==undefined&&Object.keys(value).length<schema.minProperties)throw new OperationError(t('operations.invalidInput',{field:at}));
    for(const key of schema.required||[])if(!Object.hasOwn(value,key))throw new OperationError(t('operations.invalidInput',{field:`${at}.${key}`}));
    for(const [key,item] of Object.entries(value)){
      if(!schema.properties?.[key]&&schema.additionalProperties===false)throw new OperationError(t('operations.invalidInput',{field:`${at}.${key}`}));
      validateInput(item,schema.properties?.[key]||(typeof schema.additionalProperties==='object'?schema.additionalProperties:undefined),`${at}.${key}`,root);
    }
  }
}

export const elementRefs=ids=>[...new Set(ids)].map(guid=>({elementId:{guid}}));
export const identifier=value=>typeof value==='string'?value:value?.guid||value?.elementId?.guid||value?.navigatorItemId?.guid;

export async function runOperation(context,kind,args,work) {
  const {mcp,root,signal}=context;
  const id=uid(),relative=`.archi/operations/${id}`,directory=await projectPath(root,relative);
  await fs.mkdir(directory,{recursive:true});
  const manifest={format:1,id,operation:kind,status:'running',startedAt:new Date().toISOString(),connection:{...mcp.connectionInfo},arguments:args,steps:[],checks:[],warnings:[]};
  const persist=()=>atomicJSON(path.join(directory,'manifest.json'),manifest);
  const op={...context,id,relative,directory,manifest,
    has:name=>mcp.tools.some(tool=>tool.server==='archicad'&&tool.name===name),
    tool(name){const tool=mcp.tools.find(tool=>tool.server==='archicad'&&tool.name===name);if(!tool)throw new OperationError(t('operations.unsupportedCommand',{command:name}),'unsupported');return tool;},
    async save(name,value){const file=await projectPath(directory,name);await atomicJSON(file,value);return `${relative}/${name}`;},
    async checkpoint(){await persist();},
    async call(name,input={},options={}) {
      signal.throwIfAborted();
      const tool=this.tool(name);validateInput(input,tool.inputSchema);
      const step={index:manifest.steps.length+1,command:name,status:'running',readOnly:tool.annotations?.readOnlyHint===true,startedAt:new Date().toISOString()};
      manifest.steps.push(step);
      step.input=await this.save(`step-${step.index}-input.json`,input);await persist();
      try{
        const result=normalizeExecutionResult(await mcp.call(tool.key,input,signal));
        step.result=await this.save(`step-${step.index}-result.json`,result);
        const data=resultData(result);
        step.status=result?.outcomeUnknown?'outcome_unknown':result?.isError?'failed':'completed';
        if(result?.outcomeUnknown)throw new OperationError(t('operations.unknownOutcome',{command:name}),'outcome_unknown');
        if(result?.isError&&!options.allowPartial)throw new OperationError(t('operations.commandFailed',{command:name}));
        return options.envelope?{data,failed:result?.isError===true}:data;
      }catch(error){
        if(step.status==='running')step.status=!step.readOnly?'outcome_unknown':'failed';
        step.error=error.message;
        if(step.status==='outcome_unknown')error.operationStatus='outcome_unknown';
        throw error;
      }finally{step.finishedAt=new Date().toISOString();await persist();}
    }
  };
  await persist();let result;
  try{signal.throwIfAborted();result=await work(op);manifest.status=result?.status||'completed';manifest.summary=result;}
  catch(error){manifest.status=error.operationStatus||((signal.aborted)?'cancelled':'failed');manifest.error=error.message;result={isError:true,error:error.message};}
  manifest.finishedAt=new Date().toISOString();await persist();
  return {...result,operation:kind,operationId:id,status:manifest.status,manifest:`${relative}/manifest.json`,checks:manifest.checks,warnings:manifest.warnings,
    ...(manifest.status==='outcome_unknown'?{outcomeUnknown:true}:{}),
    ...(['partial','unsupported','failed','cancelled','outcome_unknown'].includes(manifest.status)?{isError:true}:{}),
    verification:'Only the listed checks were performed; semantic correctness is not implied.'};
}

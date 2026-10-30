import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {atomicJSON,projectPath,uid} from './store.mjs';
import {runOperation,OperationError,validateInput,elementRefs} from './operation-core.mjs';
import {t} from '../locales/index.mjs';

const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const digest=value=>crypto.createHash('sha256').update(canonical(value)).digest('hex');
const equal=(a,b)=>{
  if(typeof a==='number'&&typeof b==='number')return Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));
  if(a&&b&&typeof a==='object'&&typeof b==='object')return Array.isArray(a)===Array.isArray(b)&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(key=>Object.hasOwn(b,key)&&equal(a[key],b[key]));
  return a===b;
};
const invalid=field=>new OperationError(t('operations.invalidInput',{field}));
const commands={details:'SetDetailsOfElements',property:'SetPropertyValuesOfElements'};
function inputFor(change,value=change.after){
  const elementId={guid:change.element_id};
  return change.kind==='property'?{elementPropertyValues:[{elementId,propertyId:{guid:change.property_id},propertyValue:{value}}]}:{elementsWithDetails:[{elementId,details:value}]};
}
function pick(template,source,at='details'){
  if(source===undefined)throw new OperationError(t('operations.unreadableChange',{field:at}),'unsupported');
  if(template&&typeof template==='object'&&!Array.isArray(template)){
    if(!source||typeof source!=='object')throw invalid(at);
    return Object.fromEntries(Object.entries(template).map(([key,value])=>{
      if(!Object.hasOwn(source,key))throw new OperationError(t('operations.unreadableChange',{field:`${at}.${key}`}),'unsupported');
      return [key,pick(value,source[key],`${at}.${key}`)];
    }));
  }
  return source;
}
async function readChange(op,change){
  const elements=elementRefs([change.element_id]);
  if(change.kind==='property'){
    const data=await op.call('GetPropertyValuesOfElements',{elements,properties:[{propertyId:{guid:change.property_id}}]});
    const rows=data?.propertyValuesForElements;
    if(!Array.isArray(rows)||rows.length!==1||rows[0]?.propertyValues?.length!==1)throw invalid('property response cardinality');
    const value=rows[0].propertyValues[0]?.propertyValue?.value;
    if(typeof value!=='string')throw new OperationError(t('operations.unreadableChange',{field:'property display value'}),'unsupported');
    return {value,observed:{propertyValue:value}};
  }
  const tool=op.tool('GetDetailsOfElements');
  const data=await op.call('GetDetailsOfElements',{elements,...(tool.inputSchema?.properties?.fields?{fields:['type','floorIndex','layerIndex','drawIndex','details']}:{})});
  const rows=data?.detailsOfElements;
  if(!Array.isArray(rows)||rows.length!==1||rows[0]?.error)throw invalid('detail response cardinality');
  const row=rows[0];
  return {value:pick(change.after,{floorIndex:row.floorIndex,layerIndex:row.layerIndex,drawIndex:row.drawIndex,typeSpecificDetails:row.details}),observed:row};
}
function unrequestedDifferences(change,observed){
  if(change.kind!=='details')return [];
  const ignored=[];
  function leaves(value,prefix){
    if(value&&typeof value==='object'&&!Array.isArray(value))for(const[key,item]of Object.entries(value))leaves(item,`${prefix}/${key==='typeSpecificDetails'?'details':key}`);
    else ignored.push(prefix);
  }
  leaves(change.after,'');
  const differences=[];
  function walk(before,after,prefix){
    if(ignored.some(key=>prefix===key||prefix.startsWith(key+'/'))||equal(before,after))return;
    if(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after)){
      for(const key of new Set([...Object.keys(before),...Object.keys(after)]))walk(before[key],after[key],`${prefix}/${key}`);
    }else differences.push({field:prefix,before:before??null,after:after??null});
  }
  walk(change.baseline,observed,'');return differences;
}
function checkChanges(op,changes){
  if(!Array.isArray(changes)||!changes.length||changes.length>500)throw invalid('changes');
  const keys=new Set();
  for(const change of changes){
    if(!commands[change.kind])throw invalid('change.kind');
    if(change.kind==='details'&&(!change.after||!Object.keys(change.after).length))throw invalid('change.after');
    const key=`${change.element_id.toLowerCase()}:${change.kind}:${change.property_id?.toLowerCase()||''}`;
    if(keys.has(key))throw invalid('duplicate target: combine assignments in one change');
    keys.add(key);validateInput(inputFor(change),op.tool(commands[change.kind]).inputSchema);
  }
}
async function identity(op){
  const connection=await op.call('TestConnection'),project=await op.call('GetProjectInfo');
  if(!project||typeof project!=='object'||!Object.keys(project).length)throw invalid('project identity');
  return {port:connection.port??op.mcp.port,archicad_version:connection.archicad_version,archicad_build:connection.archicad_build,tapir_installed:connection.tapir_installed,project};
}

// Only absolute assignments with a readable before/after contract are accepted.
// Creation, deletion, scripts and relative transformations cannot enter a plan.
export async function applyChangePlan(context,args={}){
  return runOperation(context,'apply_change_plan',args,async op=>{
    if((args.action||'preview')==='preview'){
      if(args.plan_id)throw invalid('plan_id is only for apply');
      checkChanges(op,args.changes);
      const project=await identity(op),changes=[];
      for(const requested of args.changes){
        const change=structuredClone(requested),read=await readChange(op,change);change.before=read.value;change.baseline=read.observed;changes.push(change);
      }
      const plan={format:2,id:uid(),project,changes,purpose:args.purpose||'',createdAt:new Date().toISOString()},hash=digest(plan);
      await atomicJSON(await projectPath(op.root,`.archi/change-plans/${plan.id}.json`),{plan,hash});
      op.manifest.checks.push('live_write_schemas','all_baselines_read','project_identity');
      return {plan_id:`${plan.id}:${hash}`,changes:changes.map(({baseline,...change})=>change),mutation:false,status:'completed',next:'Review the concrete before/after plan, then call action=apply with this plan_id. A changed baseline aborts before any write. Detail plans also compare other returned fields and stop for review if they differ after writing.'};
    }
    if(args.action!=='apply'||args.changes||!/^[-a-f0-9]{36}:[a-f0-9]{64}$/i.test(args.plan_id||''))throw invalid('action/plan_id');
    const [id,hash]=args.plan_id.split(':');
    const saved=JSON.parse(await fs.readFile(await projectPath(op.root,`.archi/change-plans/${id}.json`),'utf8'));
    const plan=saved.plan;
    if(plan?.format!==2||plan.id!==id||saved.hash!==hash||digest(plan)!==hash)throw invalid('plan integrity');
    checkChanges(op,plan.changes);
    if(digest(await identity(op))!==digest(plan.project))throw new OperationError(t('operations.projectChanged'));
    const statePath=await projectPath(op.root,`.archi/change-plans/${id}-state.json`);
    let previous;try{previous=JSON.parse(await fs.readFile(statePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    const state={plan_id:args.plan_id,operationId:op.id,items:[]};
    // Preflight the entire plan, so a known stale item cannot cause an avoidable
    // half-applied batch. Recheck each item again immediately before its write.
    for(let i=0;i<plan.changes.length;i++){
      const change=plan.changes[i],{value,observed}=await readChange(op,change);
      const desired=equal(value,change.after),baseline=equal(value,change.before);
      if(!desired&&(!baseline||!equal(observed,change.baseline)))throw new OperationError(t('operations.stalePlan',{item:i+1}));
      if(!desired&&previous?.items?.[i]?.status==='outcome_unknown')throw new OperationError(t('operations.planUnknown',{item:i+1}),'outcome_unknown');
      const differences=desired?unrequestedDifferences(change,observed):[];
      state.items.push({index:i,status:differences.length?'review_required':desired?'already_applied':'pending',...(differences.length?{unrequestedDifferences:differences}:{})});
    }
    await op.authorize?.({purpose:plan.purpose,changes:plan.changes.map(({baseline,...change})=>change),plan_id:args.plan_id});
    if(digest(await identity(op))!==digest(plan.project))throw new OperationError(t('operations.projectChanged'));
    await atomicJSON(statePath,state);
    let readbackCompleted=0;
    for(let i=0;i<plan.changes.length;i++){
      const change=plan.changes[i],item=state.items[i];
      if(state.items.some(entry=>entry.status==='review_required'))break;
      if(item.status==='already_applied')continue;
      op.signal.throwIfAborted();
      if(digest(await identity(op))!==digest(plan.project))throw new OperationError(t('operations.projectChanged'));
      const {value,observed}=await readChange(op,change);
      if(equal(value,change.after)){
        const differences=unrequestedDifferences(change,observed);
        item.status=differences.length?'review_required':'already_applied';
        if(differences.length)item.unrequestedDifferences=differences;
        await atomicJSON(statePath,state);continue;
      }
      if(!equal(value,change.before)||!equal(observed,change.baseline)){item.status='conflict';await atomicJSON(statePath,state);break;}
      // Persist uncertainty BEFORE sending: a crash after dispatch must never
      // silently replay a write. Readback can resolve the desired state only.
      item.status='outcome_unknown';await atomicJSON(statePath,state);
      try{
        await op.call(commands[change.kind],inputFor(change));
        const {value:actual,observed:after}=await readChange(op,change);
        readbackCompleted++;
        item.status=equal(actual,change.after)?'verified':'verification_failed';item.actual=actual;
        const differences=unrequestedDifferences(change,after);
        if(differences.length){item.unrequestedDifferences=differences;if(item.status==='verified')item.status='review_required';}
      }catch(error){item.error=error.message;}
      await atomicJSON(statePath,state);
      if(item.status!=='verified')break;
    }
    const savedState=await op.save('change-results.json',state);
    const verified=state.items.filter(item=>['verified','already_applied','review_required'].includes(item.status)).length;
    const requiresReview=state.items.some(item=>item.status==='review_required');
    op.manifest.checks.push('plan_hash','project_identity','all_baselines_preflight','per_item_baseline');
    if(readbackCompleted)op.manifest.checks.push('readback_after_write');
    if(readbackCompleted&&plan.changes.some(change=>change.kind==='details'))op.manifest.checks.push('unrequested_detail_field_comparison');
    return {status:state.items.some(item=>item.status==='outcome_unknown')?'outcome_unknown':verified===state.items.length&&!requiresReview?'completed':'partial',plan_id:args.plan_id,saved:savedState,verified,total:state.items.length,requiresReview,items:state.items,
      recovery:'No automatic rollback. Reapplying the same plan rereads state and skips matching targets. Unknown outcomes that do not match the desired values require a new reviewed plan.'};
  });
}

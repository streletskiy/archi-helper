import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {applyChangePlan} from '../electron/change-operations.mjs';
import {Store} from '../electron/store.mjs';
import {Agent} from '../electron/agent.mjs';

const guid=i=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'archi-change-plan-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const values=new Map([[guid(1),2],[guid(2),3]]),calls=[];
  let project='SYNTHETIC',disconnect=false,sideEffect=false,visible=false;
  const mcp={tools:['TestConnection','GetProjectInfo','GetDetailsOfElements','SetDetailsOfElements'].map(name=>({name,key:`archicad:${name}`,server:'archicad',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:name!=='SetDetailsOfElements'}})),call:async(key,args)=>{
    const name=key.split(':')[1];calls.push(name);
    if(name==='TestConnection')return {port:19723,archicad_version:27};
    if(name==='GetProjectInfo')return {projectName:project};
    if(name==='GetDetailsOfElements')return {detailsOfElements:args.elements.map(x=>({type:'Wall',layerIndex:values.get(x.elementId.guid),details:{visibility:{showOnHomeStory:visible}}}))};
    if(disconnect)throw new Error('Synthetic disconnection');
    for(const x of args.elementsWithDetails)values.set(x.elementId.guid,x.details.layerIndex);
    if(sideEffect)visible=true;
    return {executionResults:[{success:true}]};
  }};
  return {root,mcp,signal:new AbortController().signal,values,calls,switchProject:()=>project='DIFFERENT_SYNTHETIC',disconnect:()=>disconnect=true,sideEffect:()=>sideEffect=true};
}
const changes=[1,2].map(i=>({kind:'details',element_id:guid(i),after:{layerIndex:5}}));

test('change plan previews without writes, applies with readback and skips already applied values',async t=>{
  const c=await fixture(t),preview=await applyChangePlan(c,{changes,purpose:'Synthetic layer assignment'});
  assert.equal(preview.status,'completed');assert.deepEqual(preview.changes.map(x=>x.before.layerIndex),[2,3]);assert.ok(!c.calls.includes('SetDetailsOfElements'));
  let approved=0;c.authorize=async plan=>{approved++;assert.equal(plan.changes.length,2);};
  const applied=await applyChangePlan(c,{action:'apply',plan_id:preview.plan_id});
  assert.equal(applied.status,'completed');assert.equal(applied.verified,2);assert.equal(approved,1);
  const writes=c.calls.filter(x=>x==='SetDetailsOfElements').length;
  const repeated=await applyChangePlan(c,{action:'apply',plan_id:preview.plan_id});
  assert.equal(repeated.verified,2);assert.equal(c.calls.filter(x=>x==='SetDetailsOfElements').length,writes);
});

test('a stale item aborts the entire preflight before any change',async t=>{
  const c=await fixture(t),p=await applyChangePlan(c,{changes});c.values.set(guid(2),9);
  const result=await applyChangePlan(c,{action:'apply',plan_id:p.plan_id});
  assert.equal(result.status,'failed');assert.equal(c.values.get(guid(1)),2);assert.ok(!c.calls.includes('SetDetailsOfElements'));
});

test('unknown write outcome is persisted and cannot be blindly replayed',async t=>{
  const c=await fixture(t),p=await applyChangePlan(c,{changes});c.disconnect();
  const result=await applyChangePlan(c,{action:'apply',plan_id:p.plan_id});assert.equal(result.status,'outcome_unknown');
  const again=await applyChangePlan(c,{action:'apply',plan_id:p.plan_id});assert.equal(again.status,'outcome_unknown');
  assert.equal(c.calls.filter(x=>x==='SetDetailsOfElements').length,1);
});

test('project changes and plan tampering prevent writes',async t=>{
  const c=await fixture(t),p=await applyChangePlan(c,{changes});c.switchProject();
  assert.equal((await applyChangePlan(c,{action:'apply',plan_id:p.plan_id})).status,'failed');
  const file=path.join(c.root,'.archi/change-plans',p.plan_id.split(':')[0]+'.json'),data=JSON.parse(await fs.readFile(file,'utf8'));
  data.plan.changes[0].after.layerIndex=20;await fs.writeFile(file,JSON.stringify(data));
  assert.equal((await applyChangePlan(c,{action:'apply',plan_id:p.plan_id})).status,'failed');assert.ok(!c.calls.includes('SetDetailsOfElements'));
});

test('unrequested detail changes stop the batch and persist the fields requiring review',async t=>{
  const c=await fixture(t),p=await applyChangePlan(c,{changes});c.sideEffect();
  const result=await applyChangePlan(c,{action:'apply',plan_id:p.plan_id});
  assert.equal(result.status,'partial');assert.equal(result.requiresReview,true);assert.equal(result.verified,1);
  assert.equal(result.items[0].unrequestedDifferences[0].field,'/details/visibility/showOnHomeStory');
  assert.equal(c.calls.filter(x=>x==='SetDetailsOfElements').length,1);
  const persisted=JSON.parse(await fs.readFile(path.join(c.root,result.saved),'utf8'));
  assert.equal(persisted.items[0].status,'review_required');
});

test('read-only mode allows preview but forbids applying a saved plan',async t=>{
  const c=await fixture(t),store=new Store(c.root,{});await store.init('en');const session=await store.newSession(),agent=new Agent(store,c.mcp,()=>{});
  const p=await agent.executeTool(session,'apply_change_plan',{changes},'read',c.signal);assert.equal(p.status,'completed');
  await assert.rejects(agent.executeTool(session,'apply_change_plan',{action:'apply',plan_id:p.plan_id},'read',c.signal),/read.only/i);
});

test('property plans preserve Tapir display strings and verify the same property after writing',async t=>{
  const c=await fixture(t),original=c.mcp.call;let value='SYNTHETIC_BEFORE';
  for(const name of ['GetPropertyValuesOfElements','SetPropertyValuesOfElements'])c.mcp.tools.push({name,key:`archicad:${name}`,server:'archicad',inputSchema:{type:'object'},annotations:{readOnlyHint:name.startsWith('Get')}});
  c.mcp.call=async(key,args)=>{
    if(key.endsWith(':GetPropertyValuesOfElements'))return {propertyValuesForElements:[{propertyValues:[{propertyValue:{value}}]}]};
    if(key.endsWith(':SetPropertyValuesOfElements')){assert.equal(args.elementPropertyValues[0].propertyId.guid,guid(3));value=args.elementPropertyValues[0].propertyValue.value;return {executionResults:[{success:true}]};}
    return original(key,args);
  };
  const preview=await applyChangePlan(c,{changes:[{kind:'property',element_id:guid(1),property_id:guid(3),after:'SYNTHETIC_AFTER'}]});
  assert.equal(preview.changes[0].before,'SYNTHETIC_BEFORE');
  const applied=await applyChangePlan(c,{action:'apply',plan_id:preview.plan_id});assert.equal(applied.status,'completed');assert.equal(applied.items[0].actual,'SYNTHETIC_AFTER');
});

test('review mode presents the saved concrete plan before the first write',async t=>{
  const c=await fixture(t),store=new Store(c.root,{});await store.init('en');const session=await store.newSession();let approvals=0;
  const agent=new Agent(store,c.mcp,event=>{
    if(event.type==='approval'){
      approvals++;assert.ok(!c.calls.includes('SetDetailsOfElements'));assert.equal(event.approval.args.changes[0].before.layerIndex,2);assert.equal(event.approval.args.changes[0].after.layerIndex,5);
      queueMicrotask(()=>agent.approve(event.approval.id,true));
    }
  });
  const p=await agent.executeTool(session,'apply_change_plan',{changes:changes.slice(0,1),purpose:'Synthetic review'},'review',c.signal);
  const result=await agent.executeTool(session,'apply_change_plan',{action:'apply',plan_id:p.plan_id},'review',c.signal);
  assert.equal(result.status,'completed');assert.equal(approvals,1);
});

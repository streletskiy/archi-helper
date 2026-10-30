import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runOperation,validateInput} from '../electron/operation-core.mjs';
import {captureView,inspectElements} from '../electron/model-operations.mjs';
import {Store} from '../electron/store.mjs';
import {Agent} from '../electron/agent.mjs';
import {setLanguage} from '../locales/index.mjs';

const guid=i=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
const ref=i=>({elementId:{guid:guid(i)}});
const schema=properties=>({type:'object',properties});
function mockMcp(commands,call){return {tools:Object.entries(commands).map(([name,inputSchema])=>({name,key:`archicad:${name}`,server:'archicad',inputSchema,annotations:{readOnlyHint:name.startsWith('Get')}})),call:async(key,args)=>call(key.split(':')[1],args)};}
async function fixture(t){setLanguage('en');const root=await fs.mkdtemp(path.join(os.tmpdir(),'archi-operations-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}

test('operation validates full live schemas before invoking any command',async t=>{
  const root=await fixture(t);let calls=0;
  const mcp=mockMcp({Read:{type:'object',properties:{values:{type:'array',items:{type:'integer',minimum:1}}},required:['values'],additionalProperties:false}},()=>{calls++;});
  const result=await runOperation({mcp,root,signal:new AbortController().signal},'synthetic',{},op=>op.call('Read',{values:[1,0]}));
  assert.equal(result.status,'failed');assert.equal(calls,0);
  assert.throws(()=>validateInput({unexpected:true},{type:'object',properties:{},additionalProperties:false}));
  assert.throws(()=>validateInput('x',{$ref:'#/missing'}));
  assert.doesNotThrow(()=>validateInput({value:2},{type:'object',properties:{value:{$ref:'#/$defs/number'}},$defs:{number:{type:'number'}}}));
});

test('unknown mutation outcomes are checkpointed and never retried',async t=>{
  const root=await fixture(t);let calls=0;
  const mcp=mockMcp({Modify:schema({})},()=>{calls++;throw new Error('Synthetic disconnected command');});
  const result=await runOperation({mcp,root,signal:new AbortController().signal},'synthetic',{},op=>op.call('Modify'));
  assert.equal(calls,1);assert.equal(result.status,'outcome_unknown');assert.equal(result.outcomeUnknown,true);
  const manifest=JSON.parse(await fs.readFile(path.join(root,result.manifest),'utf8'));
  assert.equal(manifest.steps[0].status,'outcome_unknown');assert.ok(manifest.steps[0].input);
});

test('element reader batches, deduplicates targets and retains per-item failures',async t=>{
  const root=await fixture(t),batches=[];
  const mcp=mockMcp({GetDetailsOfElements:schema({elements:{type:'array'},fields:{type:'array'}}),GetQuantitiesOfElements:schema({elements:{type:'array'}})},(name,args)=>{
    batches.push({name,ids:args.elements.map(x=>x.elementId.guid)});
    return name==='GetDetailsOfElements'?{detailsOfElements:args.elements.map(x=>({type:'Wall',id:'SYNTHETIC',details:{height:3}}))}:
      {quantitiesOfElements:args.elements.map(x=>x.elementId.guid===guid(2)?{error:{message:'Synthetic unsupported quantity'}}:{quantities:{volume:2}})};
  });
  const result=await inspectElements({mcp,root,signal:new AbortController().signal},{element_ids:[guid(1),guid(2),guid(1),guid(3)],batch_size:2,quantities:true});
  assert.equal(result.status,'partial');assert.equal(result.processed,3);assert.equal(result.failureCount,1);
  assert.deepEqual(batches.map(x=>x.ids.length),[2,2,1,1]);
  const data=JSON.parse(await fs.readFile(path.join(root,result.saved),'utf8'));
  assert.equal(data.records.length,3);assert.deepEqual(data.records[1].elementId,ref(2).elementId);
});

test('mismatched response counts never create guessed element associations',async t=>{
  const root=await fixture(t);
  const mcp=mockMcp({GetDetailsOfElements:schema({elements:{type:'array'}})},()=>({detailsOfElements:[{type:'Wall'}]}));
  const result=await inspectElements({mcp,root,signal:new AbortController().signal},{element_ids:[guid(1),guid(2)]});
  assert.equal(result.status,'partial');assert.equal(result.failureCount,1);
  assert.ok(result.sample.every(row=>!row.details));
});

test('nested property failures remain visible in an otherwise successful element read',async t=>{
  const root=await fixture(t);
  const mcp=mockMcp({GetDetailsOfElements:schema({elements:{type:'array'}}),GetPropertyValuesOfElements:schema({elements:{type:'array'},properties:{type:'array'}})},name=>name==='GetDetailsOfElements'?{detailsOfElements:[{type:'Wall'}]}:{propertyValuesForElements:[{propertyValues:[{error:{message:'Synthetic unavailable property'}}]}]});
  const result=await inspectElements({mcp,root,signal:new AbortController().signal},{element_ids:[guid(1)],property_ids:[guid(2)]});
  assert.equal(result.status,'partial');assert.equal(result.failureCount,1);assert.equal(result.failures[0].section,'properties');
});

test('selection limits report partial coverage and do not read the omitted tail',async t=>{
  const root=await fixture(t);let read=0;
  const mcp=mockMcp({GetAllElements:schema({}),GetDetailsOfElements:schema({elements:{type:'array'}})},(name,args)=>{
    if(name==='GetAllElements')return {elements:[ref(1),ref(2),ref(3)]};
    read+=args.elements.length;return {detailsOfElements:args.elements.map(()=>({type:'Slab'}))};
  });
  const result=await inspectElements({mcp,root,signal:new AbortController().signal},{selection:'all',limit:2});
  assert.equal(result.available,3);assert.equal(result.processed,2);assert.equal(read,2);assert.equal(result.truncated,true);assert.equal(result.status,'partial');
});

test('capture uses a fresh private file and returns dimensions for normal image delivery',async t=>{
  const root=await fixture(t),files=[];
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==','base64');
  const mcp=mockMcp({GetCurrentWindowType:schema({}),SaveCurrentWindowAsImage:schema({imageFilePath:{type:'string'},format:{type:'string'}})},async(name,args)=>{
    if(name==='GetCurrentWindowType')return {currentWindowType:'FloorPlan'};
    files.push(args.imageFilePath);await fs.writeFile(args.imageFilePath,png);return {success:true};
  });
  const context={mcp,root,signal:new AbortController().signal};
  const a=await captureView(context,{caption:'Synthetic view'}),b=await captureView(context,{show_to_user:false});
  assert.equal(a.status,'completed');assert.equal(a.width,1);assert.equal(a.height,1);assert.equal(a.shownToUser,true);assert.equal(b.shownToUser,false);
  assert.notEqual(files[0],files[1]);assert.ok(files.every(file=>file.startsWith(root+path.sep)));assert.equal(a.caption,'Synthetic view');
});

test('built-in capture cannot bypass read-only mode and conflicting scopes fail before API calls',async t=>{
  const root=await fixture(t),store=new Store(root,{});await store.init('en');const session=await store.newSession();
  const mcp={tools:[],call:()=>assert.fail('Unexpected API call')},agent=new Agent(store,mcp,()=>{}),signal=new AbortController().signal;
  await assert.rejects(agent.executeTool(session,'capture_view',{},'read',signal),/read.only/i);
  const result=await agent.executeTool(session,'inspect_elements',{selection:'all',element_type:'Wall'},'read',signal);
  assert.equal(result.status,'failed');
});

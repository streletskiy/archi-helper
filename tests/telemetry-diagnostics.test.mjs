import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {Store} from '../electron/store.mjs';
import {runPython} from '../electron/python.mjs';
import {Telemetry} from '../electron/telemetry.mjs';
import {currentObservation} from '../electron/telemetry-context.mjs';
import {sanitizeEvent} from '../electron/telemetry-schema.mjs';
import {normalizeExecutionResult,sanitizeDiagnostic,toolDiagnostic} from '../electron/tool-diagnostics.mjs';
import {AgentFindings} from '../electron/agent-findings.mjs';
import {KnowledgeLibrary} from '../electron/knowledge-library.mjs';
import {sanitizeFinding} from '../electron/finding-schema.mjs';

const bundled=path.resolve('runtime/python/cpython-3.13.7-windows-x86_64-none/python.exe');
const python=process.env.ARCHI_TEST_PYTHON||(await fs.access(bundled).then(()=>bundled).catch(()=>process.platform==='win32'?'python':'python3'));
assert.equal(spawnSync(python,['-c','import json,urllib.request,runpy,threading'],{windowsHide:true}).status,0,'Python standard library is required');

async function fixture(t,handler) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'archi-telemetry-'));
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(handler(JSON.parse(body))));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const store=new Store(path.join(root,'profile'),{});await store.init('en');
  const project=await store.addProject(path.join(root,'project')),session=await store.newSession(project.id);
  const telemetry=new Telemetry(store,{runtimeEnabled:true,version:'0.0.0',environment:'test',config:{projectToken:'synthetic',host:'https://synthetic.invalid',schemaVersion:3}});
  await telemetry.init();
  t.after(async()=>{clearInterval(telemetry.timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});});
  const mcp={python,runtime:root,port:String(server.address().port)};
  const run=(code,signal=new AbortController().signal)=>telemetry.task(session,{text:'synthetic Python check',mode:'full'},null,()=>currentObservation().tool('run_python',{},()=>runPython({store,mcp,session,code,signal}),signal));
  return {store,session,telemetry,mcp,run};
}

test('diagnostic serialization retains safe exception and API categories without raw values',()=>{
  for(const exception of ['AssertionError','ArchicadError','UnsucceededCommandCall']) {
    const d=toolDiagnostic('run_python',{}, {error:`synthetic.module.${exception}: PRIVATE_TEXT`,isError:true},null,{failed:true});
    assert.equal(d.exception_type,exception);assert.equal(d.kind,'python_exception');assert.doesNotMatch(JSON.stringify(d),/PRIVATE_TEXT|synthetic.module/);
  }
  assert.equal(toolDiagnostic('run_python',{}, {error:'AssertionError',isError:true},null,{failed:true}).exception_type,'AssertionError');
  for(const error of [{code:4001,message:'PRIVATE_TEXT'},{code:-1,message:'Only multi-plane roofs are supported. PRIVATE_TEXT'}]) {
    const result={executionResults:[{success:true},{success:false,error}]};
    const d=toolDiagnostic('call_archicad',{},result,null,{failed:true});
    assert.ok(['invalid_program_status','unsupported_element_class'].includes(d.api_error));
    assert.doesNotMatch(JSON.stringify(d),/PRIVATE_TEXT|4001/);
  }
  const safe=sanitizeDiagnostic({kind:'python_exception',exception_type:'PRIVATE_TEXT',api_error:'PRIVATE_TEXT',message:'PRIVATE_TEXT',fields:['PRIVATE_TEXT'],response_shape:{PRIVATE_TEXT:'PRIVATE_TEXT',guid:'PRIVATE_TEXT'},verification:'verified'});
  assert.doesNotMatch(JSON.stringify(safe),/PRIVATE_TEXT/);assert.equal(safe.verification,'unverified');
  assert.equal(normalizeExecutionResult({elements:[{error:{message:'synthetic'}}]}).isError,true);
  assert.equal(normalizeExecutionResult({attributeIds:[{error:{message:'synthetic'}}]}).isError,true);
});

test('Python JSON API observations preserve transport bytes and reveal caught partial failures',async t=>{
  const requests=[];
  const {run,telemetry,store,session}=await fixture(t,body=>{
    requests.push(body);
    if(body.command==='API.GetStories')return {succeeded:true,result:{stories:[{name:'PRIVATE_RESPONSE',index:0}]}};
    if(body.command==='API.GetProjectInfo')return {succeeded:false,error:{code:4001,message:'PRIVATE_DIALOG'}};
    return {succeeded:true,result:{addOnCommandResponse:{executionResults:[{success:true},{success:false,error:{code:-1,message:'Only multi-plane roofs are supported. PRIVATE_ERROR'}}]}}};
  });
  const result=await run(`import json,os,sys,urllib.request,http.client
assert __name__ == '__main__'
assert len(sys.argv) == 1 and sys.argv[0] == __file__
url = 'http://127.0.0.1:' + os.environ['ARCHICAD_PORT']
request = urllib.request.Request(url, json.dumps({'command':'API.GetStories'}).encode(), {'Content-Type':'application/json'})
with urllib.request.urlopen(request) as response:
    assert isinstance(response, http.client.HTTPResponse)
    data = json.loads(response.read())
assert data['result']['stories'][0]['name'] == 'PRIVATE_RESPONSE'
body = {'command':'API.ExecuteAddOnCommand','parameters':{'addOnCommandId':{'commandNamespace':'TapirCommand','commandName':'ModifyRoofs'},'addOnCommandParameters':{'roofsWithDetails':[{'elementId':{'guid':'PRIVATE_GUID'},'buildingMaterialId':{'guid':'PRIVATE_MATERIAL'}}]}}}
# Graphisoft SDK passes bytes as a separate urlopen argument.
data = json.loads(urllib.request.urlopen(urllib.request.Request(url), json.dumps(body).encode()).read())
assert data['result']['addOnCommandResponse']['executionResults'][1]['success'] is False
assert json.loads(urllib.request.urlopen(url, json.dumps({'command':'API.GetProjectInfo'}).encode()).read())['error']['code'] == 4001
print('synthetic script completed')
`);
  assert.equal(result.exitCode,0);assert.equal(result.isError,false);assert.equal(result.output.trim(),'synthetic script completed');
  assert.equal(requests.length,3);assert.equal(requests[1].parameters.addOnCommandParameters.roofsWithDetails[0].elementId.guid,'PRIVATE_GUID');
  assert.equal(result.apiObservation.coverage,'urllib_json_api');assert.equal(result.apiObservation.truncated,false);assert.equal(result.apiObservation.calls.length,3);
  const events=telemetry.queue.filter(x=>x.event==='archi_tool_diagnostic');
  const nested=events.filter(x=>x.properties.source==='python_json_api');assert.equal(nested.length,3);
  assert.equal(nested[1].properties.command,'ModifyRoofs');assert.equal(nested[1].properties.diagnostic.api_error,'unsupported_element_class');assert.equal(nested[1].properties.outcome,'failed');
  assert.equal(nested[2].properties.diagnostic.api_error,'invalid_program_status');
  assert.equal(events.find(x=>!x.properties.source).properties.diagnostic.api_has_failures,true);
  assert.doesNotMatch(JSON.stringify(telemetry.queue),/PRIVATE_|127\.0\.0\.1|roofsWithDetails.*PRIVATE/);
  for(const event of events)assert.deepEqual(sanitizeEvent(event.event,event.properties),event.properties);
  assert.equal(session.telemetryRuns.at(-1).schemaVersion,3);assert.equal(session.telemetryRuns.at(-1).appVersion,'0.0.0');
  const files=await fs.readdir(path.join(await store.workspace(session.projectId,session.id),'.archi/scripts'));
  assert.equal(files.filter(x=>/observer\.jsonl?$/.test(x)).length,0);
});

test('Python observation limits, unread responses and opt-out do not replay or block requests',async t=>{
  let requests=0;
  const {run,telemetry,store}=await fixture(t,()=>{requests++;return {succeeded:true,result:{stories:[]}};});
  const loop=`import os,urllib.request,json
url='http://127.0.0.1:'+os.environ['ARCHICAD_PORT']
body=json.dumps({'command':'API.GetStories'}).encode()
for _ in range(43):
    with urllib.request.urlopen(url,body) as response: response.read()
`;
  const limited=await run(loop);assert.equal(limited.exitCode,0);assert.equal(requests,43);assert.equal(limited.apiObservation.calls.length,40);assert.equal(limited.apiObservation.truncated,true);
  const partial=await run(`import os,urllib.request,json
response=urllib.request.urlopen('http://127.0.0.1:'+os.environ['ARCHICAD_PORT'],json.dumps({'command':'API.GetStories'}).encode())
response.read(1)
response.close()
`);
  assert.equal(partial.exitCode,0);assert.equal(partial.apiObservation.truncated,true);assert.equal(partial.apiObservation.calls[0].diagnostic.kind,'unknown_outcome');
  const before=requests;
  const large=await run(`import os,urllib.request,json
body=json.dumps({'command':'API.GetStories','parameters':{'name':'x'*2100000}}).encode()
with urllib.request.urlopen('http://127.0.0.1:'+os.environ['ARCHICAD_PORT'],body) as response: response.read()
`);
  assert.equal(large.exitCode,0);assert.equal(requests,before+1);assert.equal(large.apiObservation.truncated,true);
  const assertion=await run('raise AssertionError');assert.equal(assertion.isError,true);assert.equal(assertion.error,'AssertionError');
  assert.equal(telemetry.queue.filter(x=>x.event==='archi_tool_diagnostic'&&!x.properties.source).at(-1).properties.diagnostic.exception_type,'AssertionError');
  store.state.telemetry.shareWorkflows=false;telemetry.queue=[];
  const disabled=await run(loop);assert.equal(disabled.exitCode,0);assert.equal(disabled.apiObservation,undefined);assert.equal(telemetry.queue.filter(x=>x.event==='archi_tool_diagnostic').length,0);
});

test('cancellation preserves completed API observations and revocation prevents late diagnostic delivery',async t=>{
  const controller=new AbortController();let revoke;
  const {run,telemetry}=await fixture(t,()=>{
    if(revoke)void telemetry.update({shareWorkflows:false});
    setTimeout(()=>controller.abort(),150);
    return {succeeded:true,result:{stories:[]}};
  });
  const code=`import os,urllib.request,json,time
with urllib.request.urlopen('http://127.0.0.1:'+os.environ['ARCHICAD_PORT'],json.dumps({'command':'API.GetStories'}).encode()) as response: response.read()
time.sleep(10)
`;
  const cancelled=await run(code,controller.signal);
  assert.equal(cancelled.termination,'cancelled');assert.equal(cancelled.outcomeUnknown,true);
  assert.equal(cancelled.apiObservation.calls.length,1);assert.equal(cancelled.apiObservation.calls[0].diagnostic.kind,'completed');
  const before=telemetry.queue.filter(x=>x.event==='archi_tool_diagnostic').length;assert.ok(before>0);
  revoke=true;
  const result=await run(code);await telemetry.preferences;
  assert.equal(result.exitCode,0);assert.equal(telemetry.queue.filter(x=>x.event==='archi_tool_diagnostic').length,0);
});


const findingConnection={archicad_version:27,archicad_build:5000,tapir_installed:'1.0.0'};
const findingRecipe={category:'api_workflow',steps:[{tool:'call_archicad',action:'read',command:'GetStories',fields:[]}],checks:['schema'],cautions:['not_independently_verified']};
const findingTrace=[{tool:'call_archicad',command:'GetStories',success:true}];
async function findingFixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'archi-findings-'));
  t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});});
  return {root,findings:new AgentFindings(root)};
}

test('agent findings persist separately, filter by connection and archive only declared bundled replacements',async t=>{
  const {root,findings}=await findingFixture(t),bundled=path.join(root,'bundled');
  const library=new KnowledgeLibrary(root,{bundled});
  const candidate=await findings.save({...findingRecipe,title:'Synthetic floor procedure',keywords:['floors','этаж'],notes:'SYNTHETIC_LOCAL_NOTE'},findingConnection,[]);
  assert.equal(candidate.confidence,'candidate');
  assert.equal((await library.context(undefined,findingConnection,{query:'GetStories'})).automatic.length,0);
  assert.equal((await findings.save(findingRecipe,findingConnection,findingTrace)).id,candidate.id);
  assert.equal((await library.context(undefined,findingConnection,{query:'GetStories'})).automatic[0].id,candidate.id);
  assert.equal((await library.context(undefined,findingConnection,{query:'floors'})).automatic[0].id,candidate.id);
  assert.equal((await library.context(undefined,findingConnection,{query:'проверка этажей'})).automatic[0].id,candidate.id);
  assert.equal((await library.context(undefined,{...findingConnection,archicad_build:5001},{query:'GetStories'})).automatic.length,0);
  assert.equal((await library.context(undefined,{...findingConnection,tapir_installed:'1.1.0'},{query:'GetStories'})).automatic.length,0);
  assert.equal((await new AgentFindings(root).readState()).records.length,1);
  await fs.mkdir(path.join(bundled,'common'),{recursive:true});
  const article=path.join(bundled,'common','synthetic.md');
  const header={id:'synthetic-procedure',title:'Synthetic procedure',summary:'Synthetic technical reference',kind:'knowledge',tags:['GetStories'],archicad:[27],compatibility:[{archicad:27,minBuild:5001}],absorbsFindings:[candidate.id.slice(8)]};
  const write=()=>fs.writeFile(article,'---\n'+Object.entries(header).map(([key,value])=>`${key}: ${JSON.stringify(value)}`).join('\n')+'\n---\n\nSynthetic procedure.\n');
  await write();
  assert.equal((await library.read(candidate.id,undefined,findingConnection)).archived,false,'other build cannot absorb the finding');
  header.compatibility[0].minBuild=5000;await write();
  let entry=await library.read(candidate.id,undefined,findingConnection);
  assert.equal(entry.archived,true);assert.equal(entry.archive.articleId,header.id);assert.match(entry.text,/SYNTHETIC_LOCAL_NOTE/);
  await assert.rejects(library.search({id:candidate.id},undefined,findingConnection));
  await findings.update({id:entry.id,revision:entry.revision,archived:false});
  entry=await library.read(candidate.id,undefined,findingConnection);assert.equal(entry.archived,false);assert.equal(entry.pinned,true);
  await findings.update({id:entry.id,revision:entry.revision,pinned:false});
  assert.equal((await library.read(candidate.id,undefined,findingConnection)).archived,true);
  await fs.unlink(article);
  entry=await library.read(candidate.id,undefined,findingConnection);assert.equal(entry.archived,false,'missing replacement restores the finding');
  await findings.update({id:entry.id,revision:entry.revision,archived:true});
  assert.equal((await library.read(candidate.id,undefined,findingConnection)).archive.reason,'user');
  assert.equal((await fs.readdir(root)).includes('knowledge'),false,'findings never write personal knowledge');
});

test('finding telemetry reconstructs public cards and never exports notes or arbitrary fields',()=>{
  const input={...findingRecipe,environment:{archicad:27,build:5000,tapir:'1.0.0'},title:'SYNTHETIC_PRIVATE_TITLE',keywords:['SYNTHETIC_PRIVATE_KEYWORD'],notes:'SYNTHETIC_PRIVATE_NOTE',fingerprint:'SYNTHETIC_PRIVATE_ID',project:'SYNTHETIC_PRIVATE_PROJECT'};
  const card=sanitizeFinding(input);assert.ok(card);assert.match(card.fingerprint,/^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(sanitizeEvent('archi_finding_shared',{finding:input,notes:input.notes})),/SYNTHETIC_PRIVATE/);
  assert.deepEqual(sanitizeFinding({...input,notes:'another synthetic note'}),card,'fingerprint derives only from the public recipe');
  for(const patch of [{steps:[{...findingRecipe.steps[0],fields:['SYNTHETIC_PRIVATE_FIELD']}]},{steps:[{...findingRecipe.steps[0],command:'SYNTHETIC_PRIVATE_COMMAND'}]},
    {checks:['SYNTHETIC_PRIVATE_CHECK']},{environment:{archicad:27,build:5000,tapir:'SYNTHETIC_PRIVATE_VERSION'}},{cautions:['SYNTHETIC_PRIVATE_CAUTION']}])assert.equal(sanitizeFinding({...input,...patch}),undefined);
});

test('finding delivery survives restarts and failures, repeats weekly and obeys live revocation',async t=>{
  const {root,findings}=await findingFixture(t);await findings.save({...findingRecipe,notes:'SYNTHETIC_LOCAL_ONLY'},findingConnection,findingTrace);
  const store=new Store(path.join(root,'profile'),{});await store.init('en');
  let now=1000000,fail=true;const batches=[];
  const options={runtimeEnabled:true,findings,now:()=>now,config:{projectToken:'synthetic',host:'https://synthetic.invalid',schemaVersion:4},
    fetcher:async(_url,request)=>{batches.push(JSON.parse(request.body).batch);if(fail)throw new Error('synthetic offline');return new Response(null,{status:200});}};
  let telemetry=new Telemetry(store,options);clearInterval(telemetry.timer);await telemetry.init();
  const originalRevision=findings.entry((await findings.readState()).records[0]).revision;
  await telemetry.flush();const first=batches[0][0];assert.equal(first.event,'archi_finding_shared');
  assert.equal(findings.entry((await findings.readState()).records[0]).revision,originalRevision,'delivery bookkeeping does not invalidate editor revisions');
  assert.doesNotMatch(JSON.stringify(batches),/SYNTHETIC_LOCAL_ONLY/);
  assert.equal((await findings.readState()).records[0].delivery.deliveredAt,undefined);
  telemetry=new Telemetry(store,{...options,findings:new AgentFindings(root)});clearInterval(telemetry.timer);await telemetry.init();
  fail=false;await telemetry.flush();assert.equal(batches[1][0].uuid,first.uuid,'retry uses persisted event UUID');
  await telemetry.flush();assert.equal(batches.length,2,'unchanged finding is not sent every flush');
  now+=7*24*60*60*1000;await telemetry.flush();assert.notEqual(batches[2][0].uuid,first.uuid,'weekly snapshot has a fresh UUID');
  await telemetry.update({shareWorkflows:false});now+=7*24*60*60*1000;await telemetry.flush();assert.equal(batches.length,3);
  await telemetry.update({shareWorkflows:true});
  const actualPending=telemetry.findings.pending.bind(telemetry.findings);
  telemetry.findings.pending=async(...args)=>{const pending=await actualPending(...args);await telemetry.update({shareWorkflows:false});return pending;};
  await telemetry.flush();assert.equal(batches.length,3,'revocation during disk read prevents capture');
  telemetry.findings.pending=actualPending;
  await telemetry.update({shareWorkflows:true});
  telemetry.fetcher=async(_url,request)=>{await telemetry.update({enabled:false});assert.equal(request.signal.aborted,true);return new Response(null,{status:200});};
  await telemetry.flush();assert.equal((await findings.readState()).records[0].delivery.deliveredAt,undefined,'revoked in-flight delivery is not acknowledged');
});

test('finding storage rejects corruption and symlink escapes without replacing original data',async t=>{
  const {root,findings}=await findingFixture(t);await findings.save(findingRecipe,findingConnection,findingTrace);
  const file=path.join(findings.root,'findings.json');await fs.writeFile(file,'synthetic corrupt input');
  await assert.rejects(findings.save(findingRecipe,findingConnection,findingTrace));assert.equal(await fs.readFile(file,'utf8'),'synthetic corrupt input');
  const outside=path.join(root,'outside');await fs.mkdir(outside);await fs.unlink(file);await fs.rmdir(findings.root);await fs.symlink(outside,findings.root,'junction');
  await assert.rejects(findings.save(findingRecipe,findingConnection,findingTrace));assert.deepEqual(await fs.readdir(outside),[]);
});

import test from 'node:test';
import { claudeTurn,claudeInput } from '../electron/claude-code.mjs';
import { claudeBridge } from '../electron/claude-bridge.mjs';
import { Client as ClaudeTestClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store,projectPath } from '../electron/store.mjs';
import { Agent,agentTools } from '../electron/agent.mjs';
import assert from 'node:assert/strict';
import { completion, models, requestMessages } from '../electron/provider.mjs';
import { responseInput } from '../electron/provider-responses.mjs';
import { providerDefinitions } from '../electron/provider-definitions.mjs';
import { modelOutputLimit, modelResponseTimeout } from '../electron/model-limits.mjs';
const definition=providerDefinitions.find(d=>d.id==='chatgpt');
const provider={...definition,definitionId:definition.id,id:'profile-1',oauth:{connectionId:'connection-1'},authorize:async()=> 'test-access',models:[]};
const tools=[{type:'function',function:{name:'read_file',description:'Read a local file',parameters:{type:'object',properties:{path:{type:'string'}}}}}];
const reasoning={type:'reasoning',id:'rs_1',summary:[],encrypted_content:'private-reasoning'};
const call={type:'function_call',id:'fc_1',namespace:'archi',name:'read_file',call_id:'call-1',arguments:'{"path":"a.txt"}',status:'completed'};
function stream(events) {return new Response(events.map(e=>`data: ${JSON.stringify(e)}\r\n\r\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});}
function mock(t,handler) {const original=globalThis.fetch;globalThis.fetch=handler;t.after(()=>{globalThis.fetch=original;});}

test('project paths accept aliased roots while rejecting traversal and escaping links',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'archi-project-path-'));
  t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});});
  const actual=path.join(root,'project'),alias=path.join(root,'linked-project'),outside=path.join(root,'outside');
  await fs.mkdir(actual);await fs.mkdir(outside);
  await fs.symlink(actual,alias,'junction');await fs.symlink(outside,path.join(actual,'escape'),'junction');
  assert.equal(await projectPath(alias,'.'),alias);
  assert.equal(await projectPath(alias,'nested/synthetic.txt'),path.join(alias,'nested/synthetic.txt'));
  await assert.rejects(projectPath(alias,'../outside/synthetic.txt'),/outside/i);
  await assert.rejects(projectPath(alias,'escape/synthetic.txt'),/outside/i);
});

test('Claude input preserves conversation and images without copying provider reasoning or credentials',()=>{
  const input=claudeInput([{role:'system',content:'separate system prompt'},{role:'assistant',content:'Earlier answer',reasoning_content:'private reasoning',_responseItems:['private items']},
    {role:'user',content:[{type:'text',text:'Inspect this image'},{type:'image_url',image_url:{url:'data:image/png;base64,YQ=='}}]}]);
  assert.doesNotMatch(input,/private reasoning|private items|separate system prompt/);
  const parsed=JSON.parse(input);assert.equal(parsed.type,'user');assert.equal(parsed.message.content[1].source.data,'YQ==');
});

test('Claude MCP is authenticated and guarded by application permissions; duplicate requests cannot replay operations',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'archi-claude-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=new Store(root,{});await store.init('en');const session=await store.newSession();
  const agent=new Agent(store,{tools:[]},()=>{}),controller=new AbortController();let count=0;
  const bridge=await claudeBridge(agentTools,async(name,args)=>{
    count++;try{return {content:[{type:'text',text:JSON.stringify(await agent.execute(session,name,args,'read',controller.signal))}]};}
    catch(error){return {isError:true,content:[{type:'text',text:error.message}]};}
  },controller.signal);t.after(()=>bridge.close());
  const config=bridge.config.mcpServers.archi;
  assert.equal((await fetch(config.url,{method:'POST',body:'{}'})).status,403);
  assert.equal((await fetch(config.url,{method:'POST',headers:{...config.headers,Origin:'https://synthetic.invalid'},body:'{}'})).status,403);
  const client=new ClaudeTestClient({name:'synthetic-client',version:'1.0.0'});t.after(()=>client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(config.url),{requestInit:{headers:config.headers}}));
  assert.equal((await client.listTools()).tools.length,agentTools.length);
  const denied=await client.callTool({name:'write_file',arguments:{path:'synthetic.txt',content:'must not write'}});
  assert.equal(denied.isError,true);assert.match(denied.content[0].text,/Read-Only|read.only/i);
  await assert.rejects(fs.access(path.join(await store.workspace(session.projectId,session.id),'synthetic.txt')));
  await assert.rejects(client.callTool({name:'Bash',arguments:{command:'ignored'}}),/Unknown tool/);
  const headers={...config.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
  const body=JSON.stringify({jsonrpc:'2.0',id:90001,method:'tools/call',params:{name:'list_files',arguments:{}}});
  const before=count;
  for(let i=0;i<2;i++){const response=await fetch(config.url,{method:'POST',headers,body});assert.equal(response.status,200);await response.text();}
  assert.equal(count,before+1);
  controller.abort();assert.equal((await fetch(config.url,{method:'POST',headers,body})).status,403);
});

test('Claude requires a successful terminal event, keeps tools constrained, and removes temporary prompts',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'archi-claude-turn-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let terminal={type:'result',subtype:'success',is_error:false},code=0;
  const manager={verify:async()=>'/synthetic/claude',options:async signal=>({cwd:root,env:{},signal}),run:async(_exe,args,options)=>{
    assert.equal(args[args.indexOf('--tools')+1],'');assert.ok(args.includes('--strict-mcp-config'));assert.ok(args.includes('--no-session-persistence'));assert.ok(!args.includes('--bare'));
    assert.deepEqual(JSON.parse(args[args.indexOf('--settings')+1]),{disableAllHooks:true});
    assert.equal(await fs.readFile(args[args.indexOf('--system-prompt-file')+1],'utf8'),'Synthetic system');
    await options.onEvent({type:'assistant',message:{id:'synthetic',content:[{type:'text',text:'Partial answer'}]}});
    if(terminal)await options.onEvent(terminal);return {code};
  }};
  const args={manager,provider:{},model:'default',messages:[{role:'system',content:'Synthetic system'}],signal:new AbortController().signal,onEvent:async()=>{}};
  await claudeTurn(args);assert.deepEqual(await fs.readdir(root),[]);
  terminal=undefined;await assert.rejects(claudeTurn(args),/did not complete/);assert.deepEqual(await fs.readdir(root),[]);
  terminal={type:'result',subtype:'error_during_execution',is_error:true};await assert.rejects(claudeTurn(args));
  terminal={type:'result',subtype:'success',is_error:false};code=1;await assert.rejects(claudeTurn(args));
});

test('Claude agent persists streamed blocks once and routes tool execution through the ordinary history and permissions',{timeout:15000},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'archi-claude-agent-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=new Store(root,{});await store.init('en');const session=await store.newSession();
  const provider={id:'synthetic-claude',adapter:'claude-code',baseURL:'https://claude.ai',supportsImages:true};store.state.providers.push(provider);
  let finished;const done=new Promise(resolve=>{finished=resolve;});
  const agent=new Agent(store,{tools:[],apiDefinitions:Promise.resolve({})},event=>{if(event.type==='busy'&&!event.busy)finished();});
  agent.prepareKnowledge=async()=>[];
  agent.knowledge.context=async()=>({automatic:[],summary:'',text:''});
  store.claudeCode={verify:async()=>'/synthetic/claude',options:async signal=>({cwd:root,env:{},signal}),run:async(_exe,args,options)=>{
    const send=options.onEvent;
    await send({type:'stream_event',event:{type:'message_start',message:{id:'synthetic-message'}}});
    await send({type:'assistant',message:{id:'synthetic-message',content:[{type:'thinking',thinking:'private reasoning'}]}});
    for(const text of ['First block. ','Second block.']) {
      await send({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text}}});
      await send({type:'assistant',message:{id:'synthetic-message',content:[{type:'text',text}]}});
    }
    await send({type:'stream_event',event:{type:'message_stop'}});
    const config=JSON.parse(args[args.indexOf('--mcp-config')+1]).mcpServers.archi;
    const client=new ClaudeTestClient({name:'synthetic',version:'1.0.0'});
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(config.url),{requestInit:{headers:config.headers}}));
      assert.equal((await client.callTool({name:'write_file',arguments:{path:'forbidden.txt',content:'synthetic'}})).isError,true);
    } catch(error) {throw new Error(`${error.stack}\n${error.cause?.stack||''}`);}
    finally {await client.close();}
    await send({type:'assistant',uuid:'synthetic-final-block',message:{id:'synthetic-final',content:[{type:'text',text:'Write was denied.'}]}});
    await send({type:'result',subtype:'success',is_error:false});return {code:0};
  }};
  await agent.enqueue({projectId:session.projectId,sessionId:session.id,providerId:provider.id,model:'default',mode:'read',text:'Synthetic task'});
  await done;
  const saved=await store.session(session.projectId,session.id);
  assert.deepEqual(saved.messages.filter(m=>m.role==='notice'),[]);assert.equal(saved.queuePaused,false);
  assert.deepEqual(saved.messages.filter(m=>m.role==='assistant').map(m=>m.text),['First block. Second block.','Write was denied.']);
  assert.equal(saved.messages.find(m=>m.role==='tool').status,'error');
  assert.equal(saved.history.filter(m=>m.role==='tool').length,1);
  assert.doesNotMatch(JSON.stringify(saved),/private reasoning/);
  await assert.rejects(fs.access(path.join(await store.workspace(session.projectId,session.id),'forbidden.txt')));
});

test('compatible replies reject truncated or malformed tool batches before execution',async t=>{
  let streamed=true,finish='length',argumentsText='{"query":"synthetic',body;
  mock(t,async(_url,init)=>{
    body=JSON.parse(init.body);
    const tool_calls=[{id:'complete',function:{name:'lookup',arguments:'{}'}},{id:'partial',function:{name:'lookup',arguments:argumentsText}}];
    return streamed?stream([{choices:[{delta:{tool_calls},finish_reason:finish}]}]):Response.json({choices:[{message:{tool_calls},finish_reason:finish}]});
  });
  const lumv={id:'synthetic',definitionId:'lumv',baseURL:'https://lumv.app/v1',models:[{id:'synthetic-model',outputWindow:8192}]};
  const run=()=>completion(lumv,'synthetic-model',[],tools,undefined,()=>{});
  for(streamed of [true,false])for(finish of ['length','tool_calls']) {
    await assert.rejects(run(),error=>error.retryableResponse===true && !(error instanceof SyntaxError));
    assert.equal(body.max_tokens,8192);
  }
  argumentsText='[]';await assert.rejects(run(),error=>error.retryableResponse===true);
  argumentsText='{}';assert.equal((await run()).tool_calls.length,2);
  lumv.models=[];await run();assert.equal(body.max_tokens,undefined);
});

test('model limits support million-token output separately from context and keep large JSON intact',async t=>{
  const configured={baseURL:'https://synthetic.example',models:[{id:'synthetic-model',contextWindow:2000000,outputWindow:1000000}]};
  const messages=[{role:'user',content:'Synthetic request'}];
  assert.equal(modelOutputLimit(configured,'synthetic-model',messages,tools),1000000);
  assert.equal(modelResponseTimeout(configured,'synthetic-model'),7200000);
  configured.models[0].contextWindow=1000;
  assert.ok(modelOutputLimit(configured,'synthetic-model',messages,tools)<950);
  configured.models[0].contextWindow=2000000;
  const args=JSON.stringify({text:'я'.repeat(1000000)});let body;
  mock(t,async(_url,init)=>{
    body=JSON.parse(init.body);
    const bytes=new TextEncoder().encode(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{id:'large',function:{name:'lookup',arguments:args}}]},finish_reason:'tool_calls'}]})}\n\n`);
    return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=65537)controller.enqueue(bytes.subarray(i,i+65537));controller.close();}}),{headers:{'Content-Type':'text/event-stream'}});
  });
  const result=await completion(configured,'synthetic-model',messages,tools,undefined,()=>{});
  assert.equal(body.max_tokens,1000000);assert.equal(result.tool_calls[0].function.arguments,args);
  configured.baseURL='https://api.openai.com/v1';await completion(configured,'synthetic-model',messages,tools,undefined,()=>{});
  assert.equal(body.max_completion_tokens,1000000);assert.equal(body.max_tokens,undefined);
});

test('Responses respects advertised output limits and safely rejects incomplete JSON',async t=>{
  const configured={...provider,models:[{id:'synthetic-model',contextWindow:2000000,outputWindow:1000000}]};
  let events=[{type:'response.completed',response:{status:'completed',output:[call]}}],body;
  mock(t,async(_url,init)=>{body=JSON.parse(init.body);return stream(events);});
  const run=()=>completion(configured,'synthetic-model',[],tools,undefined,()=>{});
  assert.equal((await run()).tool_calls.length,1);assert.equal(body.max_output_tokens,1000000);
  events=[{type:'response.incomplete',response:{status:'incomplete',incomplete_details:{reason:'max_output_tokens'}}}];
  await assert.rejects(run(),error=>error.retryableResponse===true);
  events=[{type:'response.completed',response:{status:'completed',output:[{...call,arguments:'{"path":"synthetic'}]}}];
  await assert.rejects(run(),error=>error.retryableResponse===true && !(error instanceof SyntaxError));
});

test('Lumv discovery keeps output limits separate from the model context window',async t=>{
  mock(t,async url=>Response.json(url.endsWith('/models')?{data:[{id:'synthetic-model'}]}:{providers:{lumv:{models:{'synthetic-model':{limit:{context:2000000,input:1500000,output:1000000}}}}}}));
  const [model]=await models({definitionId:'lumv',baseURL:'https://lumv.app/v1'});
  assert.equal(model.contextWindow,2000000);assert.equal(model.inputWindow,1500000);assert.equal(model.outputWindow,1000000);
});

test('compatible streams keep different IDs separate even when indices collide',async t=>{
  let fragments;
  mock(t,async()=>stream([...fragments.map(tool_calls=>({choices:[{delta:{tool_calls}}]})),{choices:[{delta:{},finish_reason:'tool_calls'}]}]));
  const run=()=>completion({baseURL:'https://synthetic.example'},'synthetic-model',[],[],undefined,()=>{});
  for(const indices of [[0,0],[undefined,undefined],[0,1]]) {
    fragments=[[...['synthetic-a','synthetic-b'].map((id,index)=>({id,index:indices[index],function:{name:'lookup',arguments:JSON.stringify({query:index?'second-command':'sample-command'})}}))]];
    const result=await run();
    assert.deepEqual(result.tool_calls.map(call=>[call.id,call.function.name,JSON.parse(call.function.arguments)]),[
      ['synthetic-a','lookup',{query:'sample-command'}],['synthetic-b','lookup',{query:'second-command'}]
    ]);
  }
});

test('compatible streams route interleaved fragments and reject ambiguous continuations',async t=>{
  let fragments;
  mock(t,async()=>stream([...fragments.map(tool_calls=>({choices:[{delta:{tool_calls}}]})),{choices:[{delta:{},finish_reason:'tool_calls'}]}]));
  const run=()=>completion({baseURL:'https://synthetic.example'},'synthetic-model',[],[],undefined,()=>{});
  fragments=[
    [{id:'a',index:0,function:{name:'lookup',arguments:'{"query":'}},{id:'b',index:1,function:{name:'lookup',arguments:'{"query":'}}],
    [{index:1,function:{arguments:'"b"}'}},{index:0,function:{arguments:'"a"}'}}]
  ];
  assert.deepEqual((await run()).tool_calls.map(call=>JSON.parse(call.function.arguments)),[{query:'a'},{query:'b'}]);
  fragments[0][1].index=0;fragments[1]=[{index:0,id:'b',function:{arguments:'"b"}'}},{index:0,id:'a',function:{arguments:'"a"}'}}];
  assert.deepEqual((await run()).tool_calls.map(call=>JSON.parse(call.function.arguments)),[{query:'a'},{query:'b'}]);
  delete fragments[1][0].id;
  await assert.rejects(run(),/ambiguous|однозначно/);
});

test('Responses sends stateless history, images and namespaced tools, and replays complete reasoning with tool outputs',async t=>{
  let body,usage;
  mock(t,async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/responses');body=JSON.parse(init.body);return stream([
    {type:'response.output_item.added',output_index:0,item:{...reasoning,encrypted_content:'partial'}},
    {type:'response.completed',response:{status:'completed',output:[reasoning,call],usage:{input_tokens:20,output_tokens:10,total_tokens:30}}}
  ]);});
  const messages=[{role:'system',content:'Instructions'},{role:'user',content:[{type:'text',text:'Read this'},{type:'image_url',image_url:{url:'data:image/png;base64,abc'}}]}];
  const result=await completion(provider,'model-a',messages,tools,undefined,()=>{},'high',value=>{usage=value;});
  assert.equal(body.store,false);assert.equal(body.stream,true);assert.equal(body.instructions,'Instructions');assert.equal(body.tools[0].type,'namespace');
  assert.equal(body.tools[0].tools[0].strict,false);assert.equal(body.input[0].content[1].type,'input_image');assert.equal(body.temperature,undefined);
  assert.equal(result.tool_calls[0].function.name,'read_file');assert.equal(usage.prompt_tokens,20);
  const history=[...messages,result,{role:'tool',tool_call_id:'call-1',content:'File content'}];
  const next=responseInput(provider,'model-a',history);assert.deepEqual(next.input[1],reasoning);assert.deepEqual(next.input[2],call);
  assert.deepEqual(next.input[3],{type:'function_call_output',call_id:'call-1',output:'File content'});
  const switched=responseInput({...provider,id:'profile-2'},'model-a',history);assert.ok(!JSON.stringify(switched).includes('private-reasoning'));
  assert.ok(!JSON.stringify(requestMessages({...provider,adapter:'openai-compatible'},'model-a',history)).includes('_response'));
});

test('late usage failure, incomplete stream and invalid tool namespace never return executable calls',async t=>{
  let events,requests=0;mock(t,async()=>{requests++;return stream(events);});
  for(const terminal of [[],[{type:'response.incomplete',response:{incomplete_details:{reason:'max_output_tokens'}}}],
    [{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}]]) {
    events=[{type:'response.output_text.delta',delta:'Partial text'},{type:'response.output_item.done',output_index:0,item:call},...terminal];
    await assert.rejects(completion(provider,'model-a',[],tools,undefined,()=>{}));
  }
  events=[{type:'response.completed',response:{status:'completed',output:[{...call,namespace:'other'}]}}];
  await assert.rejects(completion(provider,'model-a',[],tools,undefined,()=>{}));assert.equal(requests,4);
});

test('models use the current account, visibility, slugs and server order without a bundled catalog',async t=>{
  let seen=[];mock(t,async(url,init)=>{
    seen.push(new Headers(init.headers).get('Authorization'));assert.equal(url,'https://api.openai.com/v1/models');
    return Response.json({models:[{slug:'z',display_name:'Zeta',visibility:'list',supported_reasoning_levels:[{effort:'high'}]},
      {slug:'hidden',display_name:'Hidden',visibility:'hide'},{slug:'a',display_name:'Alpha',visibility:'list'}]});
  });
  const list=await models(provider);assert.deepEqual(list.map(m=>m.id),['z','a']);assert.equal(list[0].name,'Zeta');assert.deepEqual(list[0].reasoningEfforts,['high']);
  await models({...provider,id:'profile-2',authorize:async()=> 'other-access'});assert.deepEqual(seen,['Bearer test-access','Bearer other-access']);
});

test('HTTP quota errors are actionable and redact the bearer credential',async t=>{
  mock(t,async()=>Response.json({error:{code:'subscription_sharing_usage_limit_exceeded',message:'test-access'}},{status:429}));
  await assert.rejects(models(provider),error=>error.code==='subscription_sharing_usage_limit_exceeded'&&error.usageAction===definition.manageUsageURL&&!error.message.includes('test-access'));
});

test('a proxy may omit the stream content type, but completed events remain mandatory',async t=>{
  let content='data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Ready'}]}]}})+'\n\n';
  mock(t,async()=>new Response(new TextEncoder().encode(content)));
  assert.equal((await completion(provider,'model-a',[],[],undefined,()=>{})).content,'Ready');
  content=JSON.stringify({status:'completed',output:[call]});
  await assert.rejects(completion(provider,'model-a',[],tools,undefined,()=>{}));
});

test('completed stream items preserve text when the terminal output is empty',async t=>{
  const message={type:'message',id:'message-synthetic',role:'assistant',status:'completed',content:[{type:'output_text',text:'Ready'}]};
  let terminalOutput=[];
  mock(t,async()=>stream([
    {type:'response.output_item.added',output_index:0,item:{...message,status:'in_progress',content:[]}},
    {type:'response.output_text.delta',delta:'Ready'},
    {type:'response.output_item.done',output_index:0,item:message},
    {type:'response.completed',response:{status:'completed',output:terminalOutput}}
  ]));
  for(const output of [[],[message]]) {
    terminalOutput=output;let deltas='';
    const result=await completion(provider,'model-a',[],[],undefined,value=>{deltas+=value;});
    assert.equal(result.content,'Ready');assert.equal(deltas,'Ready');assert.deepEqual(result._responseItems,[message]);
  }
});

test('streamed final reasoning and tools retain output order and reusable history',async t=>{
  mock(t,async()=>stream([
    {type:'response.output_item.added',output_index:0,item:{...reasoning,encrypted_content:'partial'}},
    {type:'response.output_item.done',output_index:1,item:call},
    {type:'response.output_item.done',output_index:0,item:reasoning},
    {type:'response.completed',response:{status:'completed',output:[],usage:{input_tokens:10,output_tokens:5,total_tokens:15}}}
  ]));
  let usage;
  const result=await completion(provider,'model-a',[],tools,undefined,()=>{},'high',value=>{usage=value;});
  assert.deepEqual(result._responseItems,[reasoning,call]);assert.equal(result.tool_calls[0].id,call.call_id);assert.equal(usage.total_tokens,15);
  assert.deepEqual(responseInput(provider,'model-a',[result,{role:'tool',tool_call_id:call.call_id,content:'Synthetic result'}]).input,
    [reasoning,call,{type:'function_call_output',call_id:call.call_id,output:'Synthetic result'}]);
});

test('empty terminal output cannot authorize partial, ambiguous or failed tool streams',async t=>{
  let events;mock(t,async()=>stream(events));
  const done={type:'response.output_item.done',output_index:0,item:call};
  const completed={type:'response.completed',response:{status:'completed',output:[]}};
  for(const sequence of [
    [{type:'response.output_item.added',output_index:0,item:call},completed],
    [done,{type:'response.output_item.added',output_index:1,item:call},completed],
    [{...done,output_index:1},completed],
    [done,done,completed],
    [{...done,item:{...call,status:'in_progress'}},completed],
    [{...done,item:{...call,namespace:'other'}},completed],
    [done,completed,{type:'response.failed',response:{error:{code:'synthetic_failure'}}}],
    [done]
  ]) {events=sequence;await assert.rejects(completion(provider,'model-a',[],tools,undefined,()=>{}));}
});

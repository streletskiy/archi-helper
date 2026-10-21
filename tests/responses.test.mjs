import test from 'node:test';
import assert from 'node:assert/strict';
import { completion, models, requestMessages } from '../electron/provider.mjs';
import { responseInput } from '../electron/provider-responses.mjs';
import { providerDefinitions } from '../electron/provider-definitions.mjs';
const definition=providerDefinitions.find(d=>d.id==='chatgpt');
const provider={...definition,definitionId:definition.id,id:'profile-1',oauth:{connectionId:'connection-1'},authorize:async()=> 'test-access',models:[]};
const tools=[{type:'function',function:{name:'read_file',description:'Read a local file',parameters:{type:'object',properties:{path:{type:'string'}}}}}];
const reasoning={type:'reasoning',id:'rs_1',summary:[],encrypted_content:'private-reasoning'};
const call={type:'function_call',id:'fc_1',namespace:'archi',name:'read_file',call_id:'call-1',arguments:'{"path":"a.txt"}',status:'completed'};
function stream(events) {return new Response(events.map(e=>`data: ${JSON.stringify(e)}\r\n\r\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});}
function mock(t,handler) {const original=globalThis.fetch;globalThis.fetch=handler;t.after(()=>{globalThis.fetch=original;});}

test('Responses sends stateless history, images and namespaced tools, and replays complete reasoning with tool outputs',async t=>{
  let body,usage;
  mock(t,async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/responses');body=JSON.parse(init.body);return stream([
    {type:'response.output_item.added',item:{...reasoning,encrypted_content:'partial'}},
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
    events=[{type:'response.output_text.delta',delta:'Partial text'},{type:'response.output_item.done',item:call},...terminal];
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

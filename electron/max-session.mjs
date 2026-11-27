import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {t} from '../locales/index.mjs';

const page = {
  offset: {type:'integer', minimum:0},
  limit: {type:'integer', minimum:1, maximum:200, default:100}
};
const selection = {type:'boolean', description:'Only include the selected nodes'};
const handle = {type:'integer', minimum:1, maximum:4294967295, description:'Node handle returned by query_scene'};
const position = {type:'array', minItems:3, maxItems:3, items:{type:'number',minimum:-1e9,maximum:1e9}, description:'Absolute world position in scene units'};
const tool = (name,description,properties={},required=[]) => ({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}});

const legacyTools = [
  tool('get_bridge_status','Get the connected Max process, year and session adapter version.'),
  tool('query_scene','List scene nodes with their handles, names, classes and parent handles.',{...page, selection_only:selection}),
  tool('get_hierarchy','Read the scene hierarchy as a paginated list of nodes and parent handles.',page),
  tool('get_materials','List materials used by the scene.',page),
  tool('inspect_object','Read one node, its world position and assigned material.',{handle},['handle']),
  tool('capture_viewport','Capture the active viewport as a PNG.'),
  tool('create_object','Create one primitive at the specified world position.',{type:{type:'string',enum:['box','sphere','cylinder']},name:{type:'string',minLength:1,maxLength:128},size:{type:'number',exclusiveMinimum:0,maximum:1e9,default:25,description:'Box side length or sphere/cylinder diameter in scene units. Cylinder height matches its diameter.'},position},['type']),
  tool('transform_object','Move one object to an absolute world position.',{handle,position},['handle','position']),
  tool('undo_last','Undo the latest entry on the active scene undo stack. Read the scene again to verify.')
];

const rotate = {...position,description:'Relative X, Y, Z Euler rotation in degrees about the object pivot at the current frame.'};
const transform = tool('transform_object','Move to an absolute world position and/or rotate by an offset. Read inspect_object before and after to verify.',{
  handle,position,rotate,coordinate_system:{type:'string',enum:['world','local'],default:'world',description:'Axes for rotation only.'}
},['handle']);
transform.inputSchema.anyOf=[{required:['position']},{required:['rotate']}];
const inspect = tool('inspect_object','Read one node including class, world position and absolute world XYZ Euler rotation in degrees (equivalent angles may wrap).',{handle},['handle']);
export const sessionTools = [...legacyTools.map(item=>item.name==='transform_object'?transform:item.name==='inspect_object'?inspect:item),
  tool('run_python','Execute short Python on the selected 3ds Max main thread, with pymxs and rt (pymxs.runtime) available. Use print for bounded output. Prefer transform_object for simple rotations. Scene edits support Max undo when the underlying operation is undoable.',{
    code:{type:'string',minLength:1,maxLength:16000,description:'Python source for the interpreter inside Max.'}
  },['code'])
];
export const toolsForSession = item => item.legacySession?legacyTools:sessionTools;
export const sessionPipe = (pid,legacy=false) => 'ArchiHelper-MaxSession-v'+(legacy?'2':'3')+'-'+pid;

export async function callMaxSession(item,name,args,signal) {
  const schema=toolsForSession(item).find(tool=>tool.name===name)?.inputSchema;
  if(!schema)throw new Error(t('max.unknown'));
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>!Object.hasOwn(schema.properties,key))||
    schema.required.some(key=>!Object.hasOwn(args,key)))throw new Error(t('max.invalidArguments'));
  signal?.throwIfAborted();
  const timeout=30000;
  const expires=Date.now()+timeout;
  const ticket=name==='run_python'?randomUUID().replaceAll('-',''):undefined;
  const message=Buffer.from(JSON.stringify({pid:item.pid,year:item.year,name,args:ticket?{...args,ticket}:args,expires})+'\n');
  if(message.length>65536)throw new Error(t('max.invalidArguments'));
  if(!ticket)return sendRequest(item,message,signal,timeout);
  if(typeof args.code!=='string'||!args.code.trim()||args.code.length>16000)throw new Error(t('max.invalidArguments'));
  const dir=path.join(process.env.LOCALAPPDATA,'ArchiHelper','MaxPython');
  await fs.mkdir(dir,{recursive:true});
  const receipt=path.join(dir,ticket);
  const digest=createHash('sha256').update(args.code).digest('hex');
  await fs.writeFile(receipt,JSON.stringify({pid:item.pid,expires,digest}),{flag:'wx'});
  try {return await sendRequest(item,message,signal,timeout);}
  finally {await fs.rm(receipt,{force:true});}
}

function sendRequest(item,message,signal,timeout) {
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection('\\\\.\\pipe\\'+sessionPipe(item.pid,item.legacySession));
    const chunks=[];
    let sent=false,size=0;
    function fail(){
      if(sent)resolve({isError:true,outcomeUnknown:true,error:t('max.sessionInterrupted')});
      else reject(new Error(t('max.error')));
      socket.destroy();
    }
    const timer=setTimeout(fail,timeout);
    signal?.addEventListener('abort',fail,{once:true});
    socket.once('connect',()=>{
      if(socket.destroyed)return;
      sent=true;
      socket.write(message);
    });
    socket.on('data',chunk=>{
      size+=chunk.length;
      if(size>1024*1024)return fail();
      chunks.push(chunk);
      if(chunk.includes(10)){
        try {
          const response=JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if(!response.isError&&!Object.hasOwn(response,'result'))return fail();
          resolve(response.isError?response:response.result);
          socket.destroy();
        } catch {fail();}
      }
    });
    socket.once('error',fail);
    socket.once('close',()=>{
      clearTimeout(timer);
      signal?.removeEventListener('abort',fail);
      fail();
    });
  });
}

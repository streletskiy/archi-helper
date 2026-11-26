import net from 'node:net';
import {t} from '../locales/index.mjs';

const page = {
  offset: {type:'integer', minimum:0},
  limit: {type:'integer', minimum:1, maximum:200, default:100}
};
const selection = {type:'boolean', description:'Only include the selected nodes'};
const handle = {type:'integer', minimum:1, maximum:4294967295, description:'Node handle returned by query_scene'};
const position = {type:'array', minItems:3, maxItems:3, items:{type:'number',minimum:-1e9,maximum:1e9}, description:'Absolute world position in scene units'};
const tool = (name,description,properties={},required=[]) => ({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}});

export const sessionTools = [
  tool('get_bridge_status','Get the connected Max process, year and session adapter version.'),
  tool('query_scene','List scene nodes with their handles, names, classes and parent handles.',{...page, selection_only:selection}),
  tool('get_hierarchy','Read the scene hierarchy as a paginated list of nodes and parent handles.',page),
  tool('get_materials','List materials used by the scene.',page),
  tool('inspect_object','Read one node, its world position and assigned material.',{handle},['handle']),
  tool('capture_viewport','Capture the active viewport as a PNG.'),
  tool('create_object','Create one primitive at the specified world position.',{type:{type:'string',enum:['box','sphere','cylinder']},name:{type:'string',minLength:1,maxLength:128},position},['type']),
  tool('transform_object','Move one object to an absolute world position.',{handle,position},['handle','position']),
  tool('undo_last','Undo the latest entry on the active scene undo stack. Read the scene again to verify.')
];

export const sessionPipe = pid => 'ArchiHelper-MaxSession-v1-'+pid;

export function callMaxSession(item,name,args,signal) {
  const schema=sessionTools.find(tool=>tool.name===name)?.inputSchema;
  if(!schema)throw new Error(t('max.unknown'));
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>!Object.hasOwn(schema.properties,key))||
    schema.required.some(key=>!Object.hasOwn(args,key)))throw new Error(t('max.invalidArguments'));
  signal?.throwIfAborted();
  const timeout=30000;
  const message=Buffer.from(JSON.stringify({pid:item.pid,year:item.year,name,args,expires:Date.now()+timeout})+'\n');
  if(message.length>65536)throw new Error(t('max.invalidArguments'));
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection('\\\\.\\pipe\\'+sessionPipe(item.pid));
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

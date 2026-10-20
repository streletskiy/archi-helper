// All pixels, frames, tags and exports are authored through Aseprite MCP.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root=path.resolve(import.meta.dirname,'..');
const palette={
  '.':'#00000000',O:'#263c36',T:'#456557',t:'#324c43',L:'#7c9778',
  F:'#edbc92',H:'#ffdbaf',S:'#bc815d',Y:'#f7c844',y:'#dfa32e',
  D:'#ae7525',h:'#fff0a2',I:'#fff3ce',B:'#75b4c4',b:'#427f91',P:'#c9e6dd',W:'#eef2d4'
};
// This exact 18 x 10 pixel part is used by the logo and every character frame.
const helmet=[
  '......YYYYYY......',
  '....YYYYhYYYYY....',
  '...YYhhYhYYYYYY...',
  '..YYhhYYhYYYYYYY..',
  '..YYhYYYhYYYYYYY..',
  '.YYYhYYYhYYYYYYYy.',
  '.YYYYYYYYYYYYYYYy.',
  'YYYYYYYYYYYYYYYYYY',
  'yyyyyyyyyyyyyyyyyy',
  '.DDDDDDDDDDDDDDDD.'
];
const canvas=()=>Array.from({length:32},()=>Array(32).fill('.'));
const px=(a,x,y,c)=>{if(x>=0&&x<32&&y>=0&&y<32)a[y][x]=c;};
const rect=(a,x,y,w,h,c)=>{for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)px(a,xx,yy,c);};
const stamp=(a,rows,x,y)=>rows.forEach((r,j)=>[...r].forEach((c,i)=>{if(c!=='.')px(a,x+i,y+j,c);}));
const pixels=a=>a.flatMap((r,y)=>r.flatMap((c,x)=>c==='.'?[]:[{x,y,color:palette[c]}]));

function character(frame){
  const reading=frame>=8, n=reading?frame-8:frame;
  const bob=reading?([0,0,0,1,1,1,0,0,0,1,1,0][n]):([0,0,0,1,1,0,0,0][n]);
  const body=canvas(),hat=canvas(),prop=canvas();
  // Shoes and work trousers.
  rect(body,10,25,12,4,'O');rect(body,11,25,4,4,'t');rect(body,17,25,4,4,'T');
  rect(body,10,29,6,2,'O');rect(body,17,29,6,2,'O');px(body,11,29,'L');px(body,18,29,'L');
  if(!reading && n>=4 && n<=6){
    rect(body,17,26,6,5,'.');rect(body,17,26,5,2,'T');rect(body,20,27,5,2,'O');
    if(n===5){rect(body,21,26,5,2,'O');px(body,25,26,'L');}
    stamp(prop,['.WW.','WPPW','.PW.'],n===5?28:26,28);
  }
  // Jacket with two reflective vest strips and a little collar.
  stamp(body,[
    '....OOOOOOOO....',
    '..OOTTTTTTTTOO..',
    '.OTYYTTTTYYTTO..',
    'OTIYYTTTTYYIITO.',
    'OTIYYTTTTYYIITO.',
    '.OTYYTTTTYYTTO..',
    '..OYYTTTTYYOO...',
    '..OOOOOOOOOO....'
  ],8,18);
  // Face, ears, hair and a short beard.
  rect(body,10,10+bob,13,6,'O');rect(body,11,11+bob,11,6,'F');
  rect(body,11,11+bob,3,4,'H');rect(body,9,13+bob,2,3,'S');rect(body,22,13+bob,2,3,'S');
  rect(body,11,10+bob,11,2,'t');rect(body,11,11+bob,2,3,'t');rect(body,21,11+bob,1,3,'t');
  rect(body,12,16+bob,9,2,'S');rect(body,13,17+bob,7,1,'O');
  px(body,16,15+bob,'H');rect(body,15,16+bob,3,1,'H');
  const gaze=reading?([0,0,1,1,1,0,0,-1,-1,0,0,0][n]):0;
  const blink=(!reading&&n===3)||(reading&&n===10);
  rect(body,13+gaze,13+bob,blink?2:1,blink?1:2,'O');
  rect(body,19+gaze,13+bob,blink?2:1,blink?1:2,'O');
  stamp(hat,helmet,7,1+bob);
  if(reading){
    // Hands grip a rolled blueprint; the drawing is scanned and a corner turns.
    rect(body,7,21,3,4,'F');rect(body,24,21,3,4,'F');
    stamp(prop,[
      '.bbbbbbbbbbbbbbb.',
      'bPPPPPPPPPPPPPPPb',
      'bPBBBBBBBBBBBBBPb',
      'bPBPPBBPPPPBBBPb.',
      'bPBPPBBPPPPBBBPb.',
      'bPBBBBBBPPBBBBPb.',
      'bPPPPPPPPPPPPPPb.',
      '.bbbbbbbbbbbbbb..'
    ].map(r=>r.padEnd(17,'.')),8,20);
    rect(prop,10,21,1,5,'W');rect(prop,23,22,1,4,'P');
    const tipX=17+[0,0,1,2,2,1,0,-1,-1,0,1,0][n];
    rect(prop,tipX,21,1,4,'D');px(prop,tipX,20,'Y');
    if(n===8||n===9){rect(prop,21,20,3,2,'W');px(prop,23,22,'P');}
    px(prop,8,24,'H');px(prop,24,24,'H');
  }else{
    // One hand holds a rolled drawing; the other rests on the hip.
    rect(body,7,22,3,3,'F');rect(body,23,22,3,3,'F');
    rect(prop,6,20,3,7,'b');rect(prop,7,20,2,6,'P');px(prop,7,20,'W');
  }
  return {body,hat,prop};
}

const env={...process.env,
  PYTHONPATH:process.env.ASEPRITE_MCP_SOURCE||path.join(root,'.cache/aseprite-mcp/src'),
  PYTHONUTF8:'1',ASEPRITE_MCP_WORKSPACE:root,
  ASEPRITE_PATH:process.env.ASEPRITE_PATH||'aseprite',
  APPDATA:path.join(root,'.cache/aseprite-user')
};
for(const key of Object.keys(env))if(/api.?key|token|secret|password|credential/i.test(key))delete env[key];
await fs.mkdir(env.APPDATA,{recursive:true});await fs.mkdir(path.join(root,'assets/brand'),{recursive:true});
const client=new Client({name:'archi-helper-brand',version:'1.0'});
const transport=new StdioClientTransport({command:path.join(root,'runtime/python/cpython-3.13.7-windows-x86_64-none/python.exe'),args:['-m','aseprite_mcp'],env,stderr:'pipe'});
const log=[];
async function call(name,args){
  const result=await client.callTool({name,arguments:args},undefined,{timeout:180000});
  if(result.isError)throw new Error(`${name}: ${JSON.stringify(result.content)}`);
  const data=result.structuredContent||JSON.parse(result.content.find(c=>c.type==='text').text);
  log.push({name,args:Object.fromEntries(Object.entries(args).map(([k,v])=>[k,k==='operations'?`${v.length} operations`:v])),result:data});
  return data;
}
try{
  await client.connect(transport);
  const health=await call('health_check',{});console.log('Aseprite MCP connected:',JSON.stringify(health).slice(0,350));
  const characterFile='assets/brand/engineer.aseprite',helmetFile='assets/brand/helmet.aseprite';
  await call('create_sprite',{filename:characterFile,width:32,height:32,overwrite:true});
  const ops=['Engineer','Helmet','Blueprint'].map(name=>({op:'add_layer',args:{name}}));
  ops.push({op:'set_all_frame_durations',args:{duration_ms:200}});
  for(let f=1;f<20;f++)ops.push({op:'add_frame',args:{duration_ms:200}});
  for(let f=0;f<20;f++){
    const a=character(f);
    for(const [layer,grid] of [['Engineer',a.body],['Helmet',a.hat],['Blueprint',a.prop]])ops.push({op:'draw_pixels',args:{layer,frame:f+1,pixels:pixels(grid)}});
  }
  ops.push({op:'add_tag',args:{name:'idle',from:1,to:8,direction:'forward'}},{op:'add_tag',args:{name:'reading',from:9,to:20,direction:'forward'}});
  await call('apply_operations',{filename:characterFile,operations:ops});
  await call('create_sprite',{filename:helmetFile,width:32,height:32,overwrite:true});
  const logo=canvas();stamp(logo,helmet,7,11);
  await call('draw_pixel_map',{filename:helmetFile,rows:logo.map(r=>r.join('')),legend:palette});
  await call('export_png',{filename:helmetFile,output:'public/helmet.png',overwrite:true});
  await call('export_png',{filename:helmetFile,output:'public/icon.png',scale:16,overwrite:true});
  await call('export_png',{filename:characterFile,output:'public/mascot.png',frame:9,overwrite:true});
  await call('export_spritesheet',{filename:characterFile,output:'public/mascot-sheet.png',data_output:'assets/brand/engineer.json',sheet_type:'horizontal',overwrite:true});
  await call('export_tag_gif',{filename:characterFile,tag:'idle',output:'assets/brand/idle.gif',scale:4,overwrite:true});
  await call('export_tag_gif',{filename:characterFile,tag:'reading',output:'assets/brand/reading.gif',scale:4,overwrite:true});
  await call('export_png',{filename:characterFile,output:'assets/brand/preview.png',frame:9,scale:8,overwrite:true});
  const icons=[];
  for(const scale of [1,2,4,8]){
    const file=`assets/brand/icon-${32*scale}.png`;
    await call('export_png',{filename:helmetFile,output:file,scale,overwrite:true});
    icons.push({size:32*scale,png:await fs.readFile(path.join(root,file))});
  }
  // ICO is only a container for the PNGs exported by Aseprite, without resampling.
  const header=Buffer.alloc(6+icons.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(icons.length,4);
  let offset=header.length;
  icons.forEach(({size,png},i)=>{const p=6+i*16;header[p]=size===256?0:size;header[p+1]=header[p];header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(png.length,p+8);header.writeUInt32LE(offset,p+12);offset+=png.length;});
  await fs.writeFile(path.join(root,'public/icon.ico'),Buffer.concat([header,...icons.map(i=>i.png)]));
  const info=await call('get_sprite_info',{filename:characterFile});
  await fs.writeFile(path.join(root,'assets/brand/mcp-build.json'),JSON.stringify({server:'https://github.com/MalloyTheDev/aseprite-mcp',commit:'8b7e95b6a69405f279c17227d5314dcb63ca5533',calls:log},null,2));
  console.log(JSON.stringify(info));
}finally{await client.close();}

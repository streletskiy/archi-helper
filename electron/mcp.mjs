import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export class MCP {
  constructor(runtime) { this.runtime=runtime; this.tools=[]; this.clients=new Map(); }
  async connect(port='') {
    await this.close();
    const manifest=JSON.parse(await fs.readFile(path.join(this.runtime,'manifest.json'),'utf8'));
    this.python=path.join(this.runtime,manifest.python);
    const env={...process.env,PYTHONUTF8:'1',PYTHONNOUSERSITE:'1',ARCHICAD_MCP_SEARCH:'0',ARCHICAD_MCP_MODE:'all',ARCHICAD_TIMEOUT:'300',NO_PROXY:'127.0.0.1,localhost'};
    if(port)env.ARCHICAD_PORT=String(port); else delete env.ARCHICAD_PORT;
    for(const key of Object.keys(env))if(/(?:api.?key|token|secret|password|credential)/i.test(key))delete env[key];
    await this.add('archicad',new StdioClientTransport({command:this.python,args:['-m','archicad_mcp.server'],env,stderr:'pipe',maxBufferSize:128*1024*1024}));
    return this.tools;
  }
  async add(id, transport) {
    const client=new Client({name:'archi',version:'0.1.0'},{capabilities:{}});
    let logs='';
    if(transport.stderr)transport.stderr.on('data',chunk=>{logs=(logs+chunk.toString()).slice(-4000);});
    try{await client.connect(transport,{timeout:60000});}
    catch(e){await transport.close();throw new Error(`Не удалось запустить MCP: ${e.message}${logs?`\n${logs}`:''}`);}
    this.clients.set(id,client);
    let cursor;
    do {
      const result=await client.listTools(cursor?{cursor}:{});
      this.tools.push(...result.tools.map(t=>({...t,server:id,key:`${id}:${t.name}`}))); cursor=result.nextCursor;
    } while(cursor);
  }
  async addRemote(id,url) {
    const parsed=new URL(url); if(parsed.protocol!=='https:' && parsed.hostname!=='127.0.0.1' && parsed.hostname!=='localhost')throw new Error('MCP URL должен использовать HTTPS');
    await this.add(id,new StreamableHTTPClientTransport(parsed));
  }
  async call(key,args,signal) {
    const tool=this.tools.find(t=>t.key===key || t.name===key);
    if(!tool)throw new Error(`Инструмент не найден: ${key}`);
    return this.clients.get(tool.server).callTool({name:tool.name,arguments:args},undefined,{timeout:330000,signal});
  }
  search(query, limit=12) {
    const words=query.toLowerCase().split(/\W+/).filter(Boolean);
    return this.tools.map(t=>({t,score:words.reduce((n,w)=>n+(t.name.toLowerCase()===w?25:0)+(t.name.toLowerCase().includes(w)?8:0)+((t.description||'').toLowerCase().includes(w)?1:0),0)}))
      .filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,limit).map(({t})=>({name:t.key,description:t.description,inputSchema:t.inputSchema,readOnly:t.annotations?.readOnlyHint===true}));
  }
  async close() { await Promise.allSettled([...this.clients.values()].map(c=>c.close())); this.clients.clear(); this.tools=[]; }
}

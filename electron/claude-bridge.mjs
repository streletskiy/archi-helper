import http from 'node:http';
import crypto from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema,ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Per-turn loopback bridge. The CLI can only reach the same guarded tools as
// every other provider. No native shell/file tools or persistent MCP settings.
export async function claudeBridge(tools,execute,signal) {
  const token=crypto.randomBytes(32).toString('hex'),active=new Set(),calls=new Map();let port;
  const server=http.createServer(async(req,res)=>{
    if(signal.aborted||req.headers.host!==`127.0.0.1:${port}`||req.headers.origin||req.url!=='/mcp'||req.headers.authorization!==`Bearer ${token}`){res.writeHead(403).end();return;}
    if(req.method!=='POST'){res.writeHead(405).end();return;}
    const mcp=new Server({name:'archi-helper',version:'1.0.0'},{capabilities:{tools:{}}});
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    active.add(mcp);
    mcp.setRequestHandler(ListToolsRequestSchema,async()=>({tools:tools.map(({function:fn})=>({name:fn.name,description:fn.description,inputSchema:fn.parameters}))}));
    mcp.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
      signal.throwIfAborted();
      const {name,arguments:args={}}=request.params;
      if(!tools.some(tool=>tool.function.name===name))throw new Error('Unknown tool');
      const key=String(extra.requestId),signature=JSON.stringify([name,args]);
      const previous=calls.get(key);
      if(previous){if(previous.signature!==signature)throw new Error('Request ID reused');return previous.result;}
      const result=Promise.resolve().then(()=>execute(name,args));calls.set(key,{signature,result});
      return result;
    });
    res.once('close',()=>{active.delete(mcp);void mcp.close().catch(()=>{});});
    try {
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024){res.writeHead(413).end();return;}chunks.push(chunk);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      await mcp.connect(transport);await transport.handleRequest(req,res,body);
    } catch {if(!res.headersSent)res.writeHead(400).end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  port=server.address().port;
  return {config:{mcpServers:{archi:{type:'http',url:`http://127.0.0.1:${port}/mcp`,headers:{Authorization:`Bearer ${token}`}}}},
    async close(){await Promise.allSettled([...active].map(mcp=>mcp.close()));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

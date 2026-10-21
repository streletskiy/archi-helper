import fs from 'node:fs/promises';
import path from 'node:path';
import {projectPath} from './store.mjs';

export const CATALOG_PATH='.archi/api/catalog.json';

export function buildCatalog(mcp,definitions) {
  const connection=mcp.connectionInfo||null;
  const version=Number(connection?.archicad_version),build=Number(connection?.archicad_build);
  const releases=definitions.releases||[];
  const selected=[...releases].sort((a,b)=>b.version-a.version||b.build-a.build)
    .find(item=>item.version<version||item.version===version&&item.build<=build);
  return {schemaVersion:1,generatedAt:new Date().toISOString(),connection,
    mcp:mcp.tools.map(tool=>({name:tool.key,description:tool.description||'',inputSchema:tool.inputSchema,readOnly:tool.annotations?.readOnlyHint===true})),
    tapir:{definitionsVersion:definitions.tapir?.version,installedVersion:connection?.tapir_installed,
      note:'Bundled Tapir definitions. Availability depends on the installed add-on version; these are not Graphisoft SDK methods.',commands:definitions.tapir?.commands||[]},
    graphisoft:{sdkVersion:definitions.sdkVersion,selectedRelease:selected?.version,selectedBuild:selected?.build,connectionVerified:!!selected&&!!connection,
      availableReleases:releases.map(({version,build})=>({version,build})),commands:selected?.commands||[],types:selected?.types||[]},
    warnings:[...(!selected?['Confirm TestConnection before using direct Graphisoft API. No SDK release has been selected for this connection.']:[]),
      ...(definitions.error?[definitions.error]:[])]};
}

export async function saveApiCatalog(mcp,root) {
  if(!mcp.apiDefinitions){
    mcp.apiDefinitions=fs.readFile(path.join(mcp.runtime,'api-catalog.json'),'utf8').then(JSON.parse).catch(()=>{
      mcp.apiDefinitions=null;
      return {error:'Bundled API definitions are unavailable. Use live MCP schemas; do not guess direct API commands.'};
    });
  }
  const catalog=buildCatalog(mcp,await mcp.apiDefinitions);
  const file=await projectPath(root,CATALOG_PATH);
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(`${file}.tmp`,JSON.stringify(catalog,null,2),'utf8');
  await fs.rename(`${file}.tmp`,file);
  return catalog;
}

export function catalogSummary(catalog) {
  return {path:CATALOG_PATH,connection:catalog.connection,
    counts:{mcp:catalog.mcp.length,tapir:catalog.tapir.commands.length,graphisoft:catalog.graphisoft.commands.length,types:catalog.graphisoft.types.length},
    sdkRelease:catalog.graphisoft.selectedRelease,sdkBuild:catalog.graphisoft.selectedBuild,warnings:catalog.warnings};
}

export function searchApiCatalog(catalog,{source='all',query='',limit=12}={}) {
  const groups={mcp:catalog.mcp,tapir:catalog.tapir.commands,graphisoft:catalog.graphisoft.commands,types:catalog.graphisoft.types};
  if(source!=='all'&&!Object.hasOwn(groups,source))throw new Error('Unknown API catalog source');
  const summary=catalogSummary(catalog),term=String(query).trim().toLowerCase();
  if(!term)return {...summary,instruction:'Search with English keywords, then the exact returned name for its full schema/signature. Use source to distinguish MCP, Tapir, Graphisoft commands and SDK types.'};
  const entries=Object.entries(groups).filter(([kind])=>source==='all'||source===kind).flatMap(([kind,items])=>items.map((item,index)=>({kind,item,index})));
  const names=item=>[item.name,item.name.split(':').pop(),item.httpCommand].filter(Boolean).map(name=>name.toLowerCase());
  const exact=entries.filter(({item})=>names(item).includes(term));
  const pointer=(kind,index)=>kind==='mcp'?`/mcp/${index}`:kind==='tapir'?`/tapir/commands/${index}`:`/graphisoft/${kind==='types'?'types':'commands'}/${index}`;
  if(exact.length)return {...summary,matches:exact.map(({kind,item,index})=>({source:kind,...item,jsonPointer:pointer(kind,index)}))};
  const words=term.split(/\W+/).filter(Boolean);
  const matches=entries.map(entry=>({...entry,score:words.reduce((n,word)=>n+(entry.item.name.toLowerCase().includes(word)?8:0)+((entry.item.description||'').toLowerCase().includes(word)?1:0),0)}))
    .filter(entry=>entry.score>0).sort((a,b)=>b.score-a.score).slice(0,Math.max(1,Math.min(30,Number(limit)||12)))
    .map(({kind,item,index})=>({source:kind,name:item.name,description:item.description.split('\n')[0],jsonPointer:pointer(kind,index),schemaHint:'Search this exact name and source for its complete schema/signature before calling.'}));
  return {...summary,matches,instruction:matches.length?'Retrieve an exact match before use.':'No matching command is documented in this catalog. Do not invent a name or signature.'};
}

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..');
const configFile=process.env.ARCHI_TELEMETRY_CONFIG_FILE||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'.config'),'ArchiHelperMaintainer','posthog','ingestion.json');
const local=await fs.readFile(configFile,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT'&&!process.env.ARCHI_TELEMETRY_CONFIG_FILE)return {};throw error;});
const projectToken=process.env.ARCHI_POSTHOG_PROJECT_TOKEN||local.projectToken||'';
const host=process.env.ARCHI_POSTHOG_HOST||local.host||'https://eu.i.posthog.com';
if(projectToken&&!/^phc_[A-Za-z0-9]+$/.test(projectToken))throw new Error('A public ingestion token is required; administrative keys are forbidden');
if(process.env.ARCHI_REQUIRE_TELEMETRY_CONFIG==='1'&&!projectToken)throw new Error('Release telemetry configuration is missing');
const endpoint=new URL(host);
if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/')throw new Error('Invalid telemetry ingestion host');
const result=await build({absWorkingDir:root,entryPoints:['electron/main.mjs'],outfile:'electron/main.bundle.mjs',bundle:true,platform:'node',format:'esm',target:'node22',minify:true,metafile:true,external:['electron'],legalComments:'eof',
  define:{__ARCHI_TELEMETRY_CONFIG__:JSON.stringify({host:endpoint.origin,projectToken})},
  banner:{js:"import {createRequire as __archiCreateRequire} from 'node:module';const require=__archiCreateRequire(import.meta.url);"}});
const licenses=path.join(root,'.cache','node-licenses');
if(path.dirname(licenses)!==path.join(root,'.cache'))throw new Error('Invalid license output directory');
await fs.rm(licenses,{recursive:true,force:true});await fs.mkdir(licenses,{recursive:true});
const packages=new Map();
// Vite preserves notices in JavaScript, but ship complete license texts for
// frontend dependencies as well as the packages included by the main bundle.
async function includeFrontend(name,from=root){
  if(name.startsWith('@types/'))return;
  let directory=from;
  while(directory===root||directory.startsWith(root+path.sep)){
    const installed=path.join(directory,'node_modules',name);
    const manifest=await fs.readFile(path.join(installed,'package.json'),'utf8').then(JSON.parse).catch(()=>null);
    if(manifest){
      if(packages.has(installed))return;
      packages.set(installed,manifest);
      await Promise.all(Object.keys(manifest.dependencies||{}).map(dependency=>includeFrontend(dependency,installed)));
      return;
    }
    if(directory===root)break;directory=path.dirname(directory);
  }
  throw new Error(`Cannot locate frontend license metadata for ${name}`);
}
for(const input of Object.keys(result.metafile.inputs).filter(input=>input.startsWith('node_modules/'))){
  let directory=path.dirname(path.resolve(root,input));
  while(directory.startsWith(path.join(root,'node_modules')+path.sep)){
    const manifest=await fs.readFile(path.join(directory,'package.json'),'utf8').then(JSON.parse).catch(()=>null);
    if(manifest?.name&&manifest.version){packages.set(directory,manifest);break;}directory=path.dirname(directory);
  }
}
await Promise.all(['@tanstack/react-virtual','react','react-dom','lucide-react','react-markdown','remark-gfm'].map(name=>includeFrontend(name)));
for(const [directory,manifest] of packages){
  const destination=path.join(licenses,`${manifest.name.replace(/[^a-z0-9_.-]/gi,'_')}-${manifest.version}`);await fs.mkdir(destination,{recursive:true});
  for(const filename of await fs.readdir(directory))if(/^(licen[cs]e|notice|copying)(?:[.-]|$)/i.test(filename)&&(await fs.stat(path.join(directory,filename))).isFile())await fs.copyFile(path.join(directory,filename),path.join(destination,filename));
  await fs.writeFile(path.join(destination,'package.json'),JSON.stringify({name:manifest.name,version:manifest.version,license:manifest.license},null,2));
}
await fs.writeFile(path.join(root,'.cache','main-metafile.json'),JSON.stringify(result.metafile));
console.log(`Main process bundle: ${(await fs.stat(path.join(root,'electron/main.bundle.mjs'))).size} bytes; ${packages.size} dependency license records`);

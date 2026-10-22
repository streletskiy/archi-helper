import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..');
const result=await build({absWorkingDir:root,entryPoints:['electron/main.mjs'],outfile:'electron/main.bundle.mjs',bundle:true,platform:'node',format:'esm',target:'node22',minify:true,metafile:true,external:['electron'],legalComments:'eof',
  banner:{js:"import {createRequire as __archiCreateRequire} from 'node:module';const require=__archiCreateRequire(import.meta.url);"}});
const licenses=path.join(root,'.cache','node-licenses');
if(path.dirname(licenses)!==path.join(root,'.cache'))throw new Error('Invalid license output directory');
await fs.rm(licenses,{recursive:true,force:true});await fs.mkdir(licenses,{recursive:true});
const packages=new Map();
for(const input of Object.keys(result.metafile.inputs).filter(input=>input.startsWith('node_modules/'))){
  let directory=path.dirname(path.resolve(root,input));
  while(directory.startsWith(path.join(root,'node_modules')+path.sep)){
    const manifest=await fs.readFile(path.join(directory,'package.json'),'utf8').then(JSON.parse).catch(()=>null);
    if(manifest?.name&&manifest.version){packages.set(directory,manifest);break;}directory=path.dirname(directory);
  }
}
for(const [directory,manifest] of packages){
  const destination=path.join(licenses,`${manifest.name.replace(/[^a-z0-9_.-]/gi,'_')}-${manifest.version}`);await fs.mkdir(destination,{recursive:true});
  for(const filename of await fs.readdir(directory))if(/^(licen[cs]e|notice|copying)(?:[.-]|$)/i.test(filename)&&(await fs.stat(path.join(directory,filename))).isFile())await fs.copyFile(path.join(directory,filename),path.join(destination,filename));
  await fs.writeFile(path.join(destination,'package.json'),JSON.stringify({name:manifest.name,version:manifest.version,license:manifest.license},null,2));
}
await fs.writeFile(path.join(root,'.cache','main-metafile.json'),JSON.stringify(result.metafile));
console.log(`Main process bundle: ${(await fs.stat(path.join(root,'electron/main.bundle.mjs'))).size} bytes; ${packages.size} dependency license records`);

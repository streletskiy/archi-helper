import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), runtime=path.join(root,'runtime');
await fs.mkdir(runtime,{recursive:true});
const run=(cmd,args,options={})=>execFileSync(cmd,args,{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},...options});
const uv=execFileSync('where.exe',['uv'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/)[0];
await fs.copyFile(uv,path.join(runtime,'uv.exe'));
run(uv,['python','install','3.13.7','--install-dir',path.join(runtime,'python'),'--no-bin','--no-registry']);
const dirs=await fs.readdir(path.join(runtime,'python'),{withFileTypes:true});
const folder=dirs.find(x=>x.isDirectory() && x.name.startsWith('cpython-3.13.7') && x.name.includes('windows'))?.name;
if(!folder)throw new Error('Managed Python not found');
const python=path.join(runtime,'python',folder,'python.exe');
const lock=path.join(root,'requirements.txt');
try{await fs.access(lock);}catch{
  run(uv,['pip','compile','vendor/archicad-mcp/pyproject.toml','vendor/requirements.in','--python',python,'--output-file',lock]);
}
const sitePackages=path.join(path.dirname(python),'Lib','site-packages');
run(uv,['pip','sync','--python',python,'--target',sitePackages,lock]);
run(uv,['pip','install','--python',python,'--target',sitePackages,'--no-deps','./vendor/archicad-mcp']);
run(python,['-c','import fastmcp,archicad_mcp,archicad,PIL,pymupdf,pypdf,spylls; print("Portable runtime: imports OK")']);
run(python,[path.join(root,'electron','api_catalog.py'),path.join(runtime,'api-catalog.json')]);
await fs.writeFile(path.join(runtime,'manifest.json'),JSON.stringify({python:path.relative(runtime,python),pythonVersion:'3.13.7',archicadMcpCommit:'13b8645cf9d6c59543a9c2f6b0021ac76e2b0b36',tapirDefinitions:'1.7.2'},null,2));
await fs.copyFile(lock,path.join(runtime,'requirements.lock'));
await fs.cp(path.join(root,'electron/dictionaries'),path.join(runtime,'dictionaries'),{recursive:true});
const ocr=JSON.parse(await fs.readFile(path.join(root,'vendor/ocr/manifest.json'),'utf8'));
await fs.mkdir(path.join(runtime,'tessdata'),{recursive:true});
for(const file of ocr.files){
  const destination=path.join(runtime,'tessdata',file.name);
  let data;try{data=await fs.readFile(destination);}catch{}
  if(!data||crypto.createHash('sha256').update(data).digest('hex')!==file.sha256){
    const response=await fetch(file.url,{signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw new Error(`OCR data download failed: ${response.status}`);
    data=Buffer.from(await response.arrayBuffer());
    if(crypto.createHash('sha256').update(data).digest('hex')!==file.sha256)throw new Error(`OCR data integrity failed: ${file.name}`);
    await fs.writeFile(destination,data);
  }
}
await fs.copyFile(path.join(root,'vendor/ocr/manifest.json'),path.join(runtime,'tessdata/manifest.json'));
console.log('Portable runtime ready.');

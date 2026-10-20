import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), runtime=path.join(root,'runtime');
await fs.mkdir(runtime,{recursive:true});
const run=(cmd,args,options={})=>execFileSync(cmd,args,{cwd:root,stdio:'inherit',windowsHide:true,...options});
const uv=execFileSync('where.exe',['uv'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/)[0];
await fs.copyFile(uv,path.join(runtime,'uv.exe'));
run(uv,['python','install','3.13.7','--install-dir',path.join(runtime,'python'),'--no-bin','--no-registry']);
const dirs=await fs.readdir(path.join(runtime,'python'));
const folder=dirs.find(x=>x.startsWith('cpython-3.13.7') && x.includes('windows'));
if(!folder)throw new Error('Managed Python not found');
const python=path.join(runtime,'python',folder,'python.exe');
const lock=path.join(root,'vendor','requirements.lock');
try{await fs.access(lock);}catch{
  run(uv,['pip','compile','vendor/archicad-mcp/pyproject.toml','vendor/requirements.in','--python',python,'--output-file',lock]);
}
const sitePackages=path.join(path.dirname(python),'Lib','site-packages');
run(uv,['pip','sync','--python',python,'--target',sitePackages,lock]);
run(uv,['pip','install','--python',python,'--target',sitePackages,'--no-deps','./vendor/archicad-mcp']);
run(python,['-c','import fastmcp,archicad_mcp,archicad,PIL,fitz,pypdf; print("Portable runtime: imports OK")']);
await fs.writeFile(path.join(runtime,'manifest.json'),JSON.stringify({python:path.relative(runtime,python),pythonVersion:'3.13.7',archicadMcpCommit:'13b8645cf9d6c59543a9c2f6b0021ac76e2b0b36',tapirDefinitions:'1.7.2'},null,2));
await fs.copyFile(lock,path.join(runtime,'requirements.lock'));
console.log('Portable runtime ready.');

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const require=createRequire(import.meta.url);
const {getPath7za}=require('app-builder-lib/out/toolsets/7zip.js');

export async function archiveRuntime(runtime,destination) {
  await fs.rm(destination,{force:true});
  // Keep the non-solid 1 MiB dictionary for block reuse. Disable automatic
  // executable filters: the bundled Nsis7z cannot decode newer ARM64 filters.
  await promisify(execFile)(await getPath7za(),['a','-t7z','-m0=LZMA2','-mf=off','-ms=off','-md=1m','-mx=9','-mtm=off','-mtc=off','-mta=off',destination,'.'],{cwd:runtime,windowsHide:true,maxBuffer:1024*1024});
}

// NSIS can reuse the verified runtime as a directory. Portable and --dir builds
// must keep the ordinary runtime layout and never unpack it at application start.
export default async function packageRuntime(context) {
  if(!context.targets.some(target=>target.name==='nsis'))return;
  if(context.targets.some(target=>target.name!=='nsis'))throw new Error('Build NSIS separately from portable (npm run package)');
  const project=path.resolve(context.packager.projectDir),output=path.resolve(context.appOutDir);
  if(!output.startsWith(project+path.sep))throw new Error('Runtime packaging output must be inside the project');
  const resources=path.join(output,'resources'),runtime=path.join(resources,'runtime');
  if((await fs.lstat(runtime)).isSymbolicLink())throw new Error('Packaged runtime must be a real directory');
  const files=[];
  async function visit(directory) {
    for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
      const file=path.join(directory,entry.name);
      if(entry.isSymbolicLink())throw new Error('Runtime links cannot be preserved safely');
      if(entry.isDirectory())await visit(file);
      else if(entry.isFile()) {
        const content=await fs.readFile(file);
        files.push({path:path.relative(runtime,file).split(path.sep).join('/'),size:content.length,sha256:crypto.createHash('sha256').update(content).digest('hex')});
      }
    }
  }
  await visit(runtime);
  files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const metadata=path.join(project,'.cache','runtime-package');
  await fs.mkdir(metadata,{recursive:true});
  await fs.writeFile(path.join(metadata,'manifest.json'),JSON.stringify({schema:1,files}));
  const archive=path.join(resources,'runtime.7z');
  await archiveRuntime(runtime,archive);
  const runtimeBytes=files.reduce((sum,file)=>sum+file.size,0);
  const archiveBytes=(await fs.stat(archive)).size;
  // Reserve space for extraction while the archive still exists. The registry
  // estimate describes the installed tree after that archive has been removed.
  await fs.writeFile(path.join(metadata,'size.nsh'),`!define ARCHI_RUNTIME_KIB ${Math.ceil(runtimeBytes/1024)}\n!define ARCHI_RUNTIME_INSTALLED_KIB ${Math.ceil((runtimeBytes-archiveBytes)/1024)}\n`);
  // This is the copied build output, never the developer's source runtime.
  if(path.dirname(runtime)!==resources||path.dirname(resources)!==output)throw new Error('Invalid runtime removal target');
  await fs.rm(runtime,{recursive:true,force:true});
  console.log(`NSIS runtime: ${files.length} verified files in a reusable package`);
}

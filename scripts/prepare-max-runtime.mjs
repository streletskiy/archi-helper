import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const setup={
  file:'setup.exe',
  url:'https://github.com/cl0nazepamm/3dsmax-mcp/releases/download/v2.0.1/3dsmax-mcp-2.0.1-Setup.exe',
  sha256:'53b5af9ac0094384d88616a101b13886e87620e64745d1b6242b07c0372919e0',
};
const unpacker={
  file:'unpacker.zip',
  url:'https://raw.githubusercontent.com/jrathlev/InnoUnpacker-Windows-GUI/578d3af5ec8aae028c21eb2d23532edf83f49df5/innounp-2/bin/innounp-267.zip',
  sha256:'ac1d98bba6588072ade06163781938df274f444bec7318069668608d1e5faae8',
};
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

async function verifiedFile(cache,asset) {
  const file=path.join(cache,asset.file);
  let cached;
  try{cached=await fs.readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(cached&&digest(cached)===asset.sha256)return file;
  const response=await fetch(asset.url,{signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw new Error('Max distribution download failed: '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(digest(bytes)!==asset.sha256)throw new Error('Max distribution checksum mismatch: '+asset.file);
  await fs.writeFile(file,bytes);
  return file;
}

// Max keeps native Python modules mapped while a scene is open. An incremental
// build can reuse a byte-identical file without trying to replace the loaded DLL.
async function needsCopy(source,target) {
  let existing;
  try{existing=await fs.stat(target);}catch(error){if(error.code==='ENOENT')return true;throw error;}
  if(!existing.isFile()||(await fs.stat(source)).size!==existing.size)return true;
  const [before,after]=await Promise.all([fs.readFile(target),fs.readFile(source)]);
  return !before.equals(after);
}

export async function prepareMaxRuntime(root,python) {
  const cache=path.join(root,'.cache','max-distribution','2.0.1');
  await fs.mkdir(cache,{recursive:true});
  const [installer,archive]=await Promise.all([verifiedFile(cache,setup),verifiedFile(cache,unpacker)]);
  const staging=await fs.mkdtemp(path.join(cache,'extract-'));
  const dest=path.join(root,'runtime','max-mcp');
  try {
    execFileSync(python,['-m','zipfile','-e',archive,staging],{windowsHide:true});
    // Extract the distribution without running its installer or configuring other MCP clients.
    execFileSync(path.join(staging,'innounp.exe'),['-x','-y','-d'+staging,installer],{windowsHide:true,stdio:['ignore','ignore','inherit']});
    const app=path.join(staging,'{app}');
    await fs.mkdir(dest,{recursive:true});
    await fs.cp(path.join(app,'runtime'),path.join(dest,'runtime'),{recursive:true,filter:needsCopy});
    await fs.cp(path.join(staging,'{commonappdata}','Autodesk','ApplicationPlugins','3dsmax-mcp'),path.join(dest,'3dsmax-mcp'),{recursive:true,filter:needsCopy});
    await fs.copyFile(path.join(app,'LICENSE.txt'),path.join(dest,'LICENSE.txt'));
    execFileSync(path.join(dest,'runtime','python.exe'),['-B','-c',"from maxmcp.server import mcp; print('3dsmax-mcp ready')"],{windowsHide:true,stdio:'inherit'});
  } finally {await fs.rm(staging,{recursive:true,force:true});}
}

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { appFetch } from './network.mjs';
import { t } from '../locales/index.mjs';

const releases='https://downloads.claude.ai/claude-code-releases';
async function request(fetcher,url,signal) {
  const response=await fetcher(url,{signal,redirect:'error'});
  if(!response.ok||!response.body)throw new Error(t('claude.downloadFailed'));
  return response;
}
async function smallText(fetcher,url,signal,max) {
  const response=await request(fetcher,url,signal),chunks=[];let size=0;
  for await(const chunk of response.body){signal.throwIfAborted();size+=chunk.length;if(size>max)throw new Error(t('claude.invalidRelease'));chunks.push(chunk);}
  return Buffer.concat(chunks).toString('utf8');
}

// Follow Anthropic's native installer: verified release binary, then its own
// `install <version>` command. Never execute a downloaded shell script.
export async function installClaude({folder,run,find,options,signal,onProgress=()=>{},fetcher=appFetch,platform=process.platform,arch=process.arch}) {
  if(platform!=='win32'||!['x64','arm64'].includes(arch))throw new Error(t('claude.installUnsupported'));
  onProgress({stage:'downloading'});
  const version=(await smallText(fetcher,`${releases}/latest`,signal,128)).trim();
  if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error(t('claude.invalidRelease'));
  let manifest;try{manifest=JSON.parse(await smallText(fetcher,`${releases}/${version}/manifest.json`,signal,1024*1024));}catch(error){if(error instanceof SyntaxError)throw new Error(t('claude.invalidRelease'));throw error;}
  const entry=manifest?.platforms?.[`${platform}-${arch}`];
  if(manifest?.version!==version||entry?.binary!=='claude.exe'||!/^[a-f0-9]{64}$/.test(entry?.checksum||'')||!Number.isSafeInteger(entry?.size)||entry.size<=0||entry.size>512*1024*1024)throw new Error(t('claude.invalidRelease'));
  await fs.mkdir(folder,{recursive:true});
  const file=path.join(folder,`claude-${crypto.randomUUID()}.exe`);
  try {
    const response=await request(fetcher,`${releases}/${version}/${platform}-${arch}/claude.exe`,signal);
    const handle=await fs.open(file,'wx'),hash=crypto.createHash('sha256');let bytes=0,last=0;
    try {
      for await(const chunk of response.body) {
        signal.throwIfAborted();bytes+=chunk.length;if(bytes>entry.size)throw new Error(t('claude.checksumMismatch'));
        hash.update(chunk);await handle.writeFile(chunk);
        if(Date.now()-last>=200){onProgress({stage:'downloading',percent:Math.floor(bytes/entry.size*100)});last=Date.now();}
      }
    } finally {await handle.close();}
    onProgress({stage:'verifying'});signal.throwIfAborted();
    if(bytes!==entry.size||hash.digest('hex')!==entry.checksum)throw new Error(t('claude.checksumMismatch'));
    onProgress({stage:'installing'});
    const result=await run(file,['install',version],{...options,signal});
    signal.throwIfAborted();
    if(result.code!==0)throw new Error(t('claude.installFailed'));
    const executable=await find();
    const installed=await run(executable,['--version'],{...options,signal});
    if(installed.code!==0||installed.stdout.trim()!==`${version} (Claude Code)`)throw new Error(t('claude.installFailed'));
    return executable;
  } finally {await fs.unlink(file).catch(()=>{});}
}

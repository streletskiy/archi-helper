import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { t } from '../locales/index.mjs';

export async function installTapir({fetch,folder,openPath,onProgress=()=>{}}) {
  onProgress({status:'checking',version:'',percent:0,transferred:0,total:0,bytesPerSecond:0,message:''});
  const response=await fetch('https://api.github.com/repos/ENZYME-APD/tapir-archicad-automation/releases/latest',{
    headers:{'User-Agent':'Archi-Helper'},signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error(`GitHub HTTP ${response.status}`);
  const release=await response.json(),name='TapirInstaller_Win.exe',asset=release.assets?.find(item=>item.name===name);
  if(!asset||!/^sha256:[a-f0-9]{64}$/.test(asset.digest||''))throw new Error(t('errors.thisReleaseHasNoVerifiableFileFor'));
  const url=new URL(asset.browser_download_url);
  if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||!url.pathname.startsWith('/ENZYME-APD/tapir-archicad-automation/releases/download/'))throw new Error(t('errors.unexpectedReleaseUrl'));
  onProgress({status:'downloading',version:String(release.tag_name||''),total:Number(asset.size)||0});
  const dataResponse=await fetch(url,{signal:AbortSignal.timeout(120000)});
  if(!dataResponse.ok)throw new Error(t('errors.tapirDownloadHttp',{value0:dataResponse.status}));
  const total=Number(asset.size)||Number(dataResponse.headers.get('content-length'))||0,chunks=[];
  const startedAt=performance.now();let transferred=0,lastProgressAt=startedAt;
  const transfer=()=>({transferred,total,percent:total>0?Math.min(100,Math.floor(transferred/total*100)):0,bytesPerSecond:Math.round(transferred/Math.max(.001,(performance.now()-startedAt)/1000))});
  for await(const chunk of dataResponse.body) {
    chunks.push(Buffer.from(chunk));transferred+=chunk.byteLength;
    if(performance.now()-lastProgressAt>=150){onProgress(transfer());lastProgressAt=performance.now();}
  }
  onProgress({...transfer(),status:'verifying',percent:100});
  const bytes=Buffer.concat(chunks,transferred),digest=crypto.createHash('sha256').update(bytes).digest('hex');
  if(`sha256:${digest}`!==asset.digest)throw new Error(t('errors.tapirChecksumMismatch'));
  const destination=path.join(folder,digest);
  await fs.mkdir(destination,{recursive:true});
  const file=path.join(destination,name);
  await fs.writeFile(file,bytes);
  onProgress({status:'installing',bytesPerSecond:0});
  const error=await openPath(file);
  if(error)throw new Error(t('errors.tapirInstallerLaunchFailed',{error}));
  const message=t('ui.tapirInstallerLaunchedMessage');
  onProgress({status:'launched',message});
  return {version:release.tag_name,file,launched:true,sha256:digest,message};
}

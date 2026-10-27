import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const sources=JSON.parse(await fs.readFile(path.join(root,'vendor/pymupdf-source.json'),'utf8'));
const lock=await fs.readFile(path.join(root,'vendor/requirements.txt'),'utf8');
if(!lock.split(/\r?\n/).includes(`pymupdf==${sources[0].version}`))throw new Error('Source version differs from runtime lock');
await fs.mkdir(path.join(root,'release'),{recursive:true});
for(const source of sources){
  const response=await fetch(source.url,{signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw new Error(`Source download failed: HTTP ${response.status}`);
  const data=Buffer.from(await response.arrayBuffer());
  if(crypto.createHash('sha256').update(data).digest('hex')!==source.sha256)throw new Error('Source SHA-256 mismatch');
  await fs.writeFile(path.join(root,'release',source.filename),data);
  console.log(`Verified source archive: ${source.filename}`);
}

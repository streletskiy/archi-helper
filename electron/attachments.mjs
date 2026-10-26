import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { t } from '../locales/index.mjs';

export async function clipboardAttachments(clipboard) {
  const items=await clipboard.read(),files=[];
  for(const item of items)if(item.types.includes('text/uri-list')) {
    const list=await (await item.getType('text/uri-list')).text();
    for(const line of list.split(/\r?\n/).map(value=>value.trim()).filter(value=>value&&!value.startsWith('#'))) {
      const url=new URL(line);
      if(url.protocol!=='file:')throw new Error(t('errors.attachLocalFilesOnly'));
      files.push({path:fileURLToPath(url)});
    }
  }
  if(files.length)return files;
  for(const item of items) {
    const type=['image/png','image/jpeg','image/webp'].find(type=>item.types.includes(type));
    if(type)files.push({name:`clipboard.${type==='image/jpeg'?'jpg':type.slice(6)}`,data:new Uint8Array(await (await item.getType(type)).arrayBuffer())});
  }
  return files;
}

export async function saveAttachments(store,projectId,sessionId,sources) {
  store.assertActive(projectId,await store.session(projectId,sessionId));
  if(!Array.isArray(sources)||sources.length>100)throw new Error(t('errors.invalidAttachments'));
  if(!sources.length)return [];
  const prepared=[],seen=new Set();
  for(const source of sources) {
    if(typeof source?.path==='string'&&path.isAbsolute(source.path)) {
      const real=await fs.realpath(source.path);
      if(seen.has(real))continue;
      if(!(await fs.stat(real)).isFile())throw new Error(t('errors.attachFilesNotFolders'));
      seen.add(real);prepared.push({path:real,name:path.basename(source.path)});
    }else if(typeof source?.name==='string'&&source.data instanceof Uint8Array) {
      if(!source.name||source.name!==path.basename(source.name)||/[<>:"/\\|?*\x00-\x1f]/.test(source.name))throw new Error(t('errors.invalidAttachments'));
      prepared.push({name:source.name,data:source.data});
    }else throw new Error(t('errors.invalidAttachments'));
  }
  const root=await store.workspace(projectId,sessionId),created=[];
  await fs.mkdir(path.join(root,'attachments'),{recursive:true});
  try {
    for(const source of prepared) {
      const relative=`attachments/${crypto.randomUUID()}-${source.name}`,destination=path.join(root,relative);
      created.push({relative,destination});
      if(source.path)await fs.copyFile(source.path,destination,fs.constants.COPYFILE_EXCL);
      else await fs.writeFile(destination,source.data,{flag:'wx'});
    }
    return created.map(file=>file.relative);
  }catch(error){await Promise.all(created.map(file=>fs.rm(file.destination,{force:true})));throw error;}
}

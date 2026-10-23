import { readFileSync } from 'node:fs';
export const SYSTEM = readFileSync(new URL('./knowledge/prompts/system.md',import.meta.url),'utf8').trim();
const runtime=Object.fromEntries(readFileSync(new URL('./knowledge/prompts/runtime.md',import.meta.url),'utf8').split(/^## /m).slice(1).map(section=>{
  const split=section.indexOf('\n');return [section.slice(0,split).trim(),section.slice(split+1).trim()];
}));

export function systemMessage(root, supportsImages, mode, catalog, storage={}) {
  const values={root,workspace:storage.workspace||'',migration:storage.legacyProjectFiles?runtime.migrated:'',vision:runtime[supportsImages?'images':'text-only'],permission:runtime[['read','full'].includes(mode)?mode:'review'],knowledge:JSON.stringify(storage.knowledge||null),catalog:JSON.stringify(catalog||null)};
  return `${SYSTEM}\n${runtime.context.replace(/\{\{(\w+)\}\}/g,(_match,key)=>values[key])}`;
}

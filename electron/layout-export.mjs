import fs from 'node:fs/promises';
import path from 'node:path';
import { t } from '../locales/index.mjs';

// Only this fixed operation skips review-mode approval. Arbitrary Python and
// generic Publisher calls retain their normal permissions.
export async function exportLayoutsPdf({mcp,root,publisherSetName,signal}) {
  if(typeof publisherSetName!=='string'||!publisherSetName.trim())throw new Error(t('agent.publisherSetRequired'));
  const tool=mcp.tools.find(tool=>tool.server==='archicad'&&tool.name==='PublishPublisherSet');
  if(!tool)throw new Error(t('agent.pdfPublisherUnavailable'));
  const parent=path.join(root,'.archi','exports');
  await fs.mkdir(parent,{recursive:true});
  const output=await fs.mkdtemp(path.join(parent,'pdf-'));
  const outputDirectory=path.relative(root,output).replaceAll('\\','/');
  signal.throwIfAborted();
  let result;
  try {
    result=await mcp.call(tool.key,{publisherSetName,outputPath:output},signal);
  } catch(error) {
    return {isError:true,error:error.message,outputDirectory,outcomeUnknown:true,
      recovery:'Publishing may still be running in Archicad. Inspect this output directory and Archicad before retrying. Do not replay the export.'};
  }
  const pdfs=[],otherFiles=[],invalidPdfs=[];
  async function inspect(folder) {
    for(const entry of await fs.readdir(folder,{withFileTypes:true})) {
      const file=path.join(folder,entry.name);
      if(entry.isDirectory()){await inspect(file);continue;}
      if(!entry.isFile())continue;
      const relative=path.relative(root,file).replaceAll('\\','/');
      if(!/\.pdf$/i.test(entry.name)){otherFiles.push(relative);continue;}
      const handle=await fs.open(file,'r');
      try {
        const header=Buffer.alloc(5),{bytesRead}=await handle.read(header,0,5,0);
        if(bytesRead!==5||header.toString()!=='%PDF-'){invalidPdfs.push(relative);continue;}
        pdfs.push({path:relative,bytes:(await handle.stat()).size});
      } finally {await handle.close();}
    }
  }
  await inspect(output);
  const failed=result?.isError===true||!pdfs.length||invalidPdfs.length>0;
  return {isError:failed,...(failed?{error:t('agent.pdfExportIncomplete')}:{}),...(result?.isError?{outcomeUnknown:true}:{}),outputDirectory,pdfs,otherFiles,invalidPdfs,publisherResult:result,
    instruction:'An empty Publisher response is not proof of export. Validate PDF page counts and map pages to the complete layout registry; report missing layouts and text/visual coverage separately. The configured publisher set controls the format and contents. Never infer full coverage from file count.'};
}

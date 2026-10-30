import fs from 'node:fs/promises';
import path from 'node:path';
import {runPython} from './python.mjs';
import {DOCUMENT_WORKER} from './document-worker.mjs';
import {runOperation,OperationError,identifier} from './operation-core.mjs';
import {exportLayoutsPdf} from './layout-export.mjs';
import {t} from '../locales/index.mjs';

export function navigatorItems(tree,parents=[]) {
  const node=tree?.navigatorItem||tree;
  if(!node||typeof node!=='object')return [];
  const item={guid:identifier(node.navigatorItemId),sourceGuid:identifier(node.sourceNavigatorItemId),type:node.type,name:node.name||'',number:node.uiId||'',path:parents};
  return [item,...(node.children||[]).flatMap(child=>navigatorItems(child,[...parents,node.name||'']))];
}

export async function processPdfs(op,files,args={}) {
  const request={...args,files,directory:op.directory,dictionaries:path.join(op.mcp.runtime,'dictionaries'),tessdata:path.join(op.mcp.runtime,'tessdata')};
  const requestPath=await op.save('document-input.json',request);
  const code=DOCUMENT_WORKER+`\nprocess_documents(json.loads(Path(${JSON.stringify(path.join(op.root,requestPath))}).read_text(encoding='utf-8')))\n`;
  const run=await runPython({...op,code,timeoutSeconds:args.timeout_seconds||300});
  await op.save('document-process.json',run);
  if(run.isError)throw new OperationError(`${run.error}. Partial artifacts, when available: ${op.relative}/document.json; process log: ${run.log}`,run.termination==='cancelled'?'cancelled':'partial');
  const report=JSON.parse(await fs.readFile(path.join(op.directory,'document.json'),'utf8'));
  op.manifest.checks.push('pdf_open_and_parse','page_text_and_coordinates','separate_text_image_visual_coverage');
  return report;
}

const normalize=text=>String(text||'').normalize('NFC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
const containsLabel=(text,label)=>new RegExp(`(?<![\\p{L}\\p{N}])${normalize(label).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\p{L}\\p{N}])`,'u').test(normalize(text));
export function matchLayoutPages(layouts,pages,publisherItems=[]) {
  return layouts.map(layout=>{
    const exact=publisherItems.filter(item=>item.guid===layout.guid||item.sourceGuid===layout.guid);
    // A number alone is ambiguous across subsets. Both number and title must
    // match, and candidate pages may not be reused by another layout.
    const candidates=pages.filter(page=>layout.number&&layout.name&&containsLabel(page.text,layout.number)&&containsLabel(page.text,layout.name));
    return {...layout,publisherMatches:exact,pages:candidates.map(page=>({source:page.source,page:page.page})),status:candidates.length===1?'matched':candidates.length?'ambiguous':'missing',matchMethod:'number_and_title_text'};
  }).map((item,_index,all)=>{
    if(item.status==='matched'&&all.some(other=>other!==item&&other.pages.some(page=>page.source===item.pages[0].source&&page.page===item.pages[0].page)))return {...item,status:'ambiguous'};
    return item;
  });
}

export async function exportLayoutPackage(context,args={}) {
  return runOperation(context,'export_layout_package',args,async op=>{
    const layouts=navigatorItems((await op.call('GetNavigatorItemTree',{navigatorMapId:'LayoutBook'})).navigatorItemTree).filter(item=>item.type==='LayoutItem');
    const namesData=await op.call('GetPublisherSetNames');
    const names=Array.isArray(namesData)?namesData:namesData?.publisherSetNames;
    if(!Array.isArray(names)||names.some(name=>typeof name!=='string'))throw new OperationError(t('operations.invalidResponse',{command:'GetPublisherSetNames'}));
    const selected=args.publisher_set_names?.length?[...new Set(args.publisher_set_names)]:names;
    if(selected.some(name=>!names.includes(name)))throw new OperationError(t('operations.invalidInput',{field:'publisher_set_names'}));
    const sets=[];
    for(const name of selected){
      const tree=await op.call('GetNavigatorItemTree',{navigatorMapId:'PublisherSets',publisherSetName:name});
      sets.push({name,items:navigatorItems(tree.navigatorItemTree)});
    }
    const registry=await op.save('layout-registry.json',{layouts,sets});
    if(args.action!=='export')return {status:'completed',registry,layouts,sets,exported:false,requirements:['Choose existing sets configured for PDF output. Publishing preserves their configured format and content.','Export never creates or changes Publisher sets.']};
    if(!args.publisher_set_names?.length)throw new OperationError(t('operations.invalidInput',{field:'publisher_set_names required for export'}));
    const outputs=[],files=[];
    for(const set of sets){
      op.signal.throwIfAborted();
      const output=await exportLayoutsPdf({mcp:op.mcp,root:op.root,publisherSetName:set.name,signal:op.signal});
      outputs.push({set:set.name,...output});await op.save('exports.json',outputs);
      files.push(...(output.pdfs||[]).map(file=>({label:file.path,path:path.join(op.root,file.path)})));
      if(output.outcomeUnknown)throw new OperationError(t('operations.unknownOutcome',{command:'PublishPublisherSet'}),'outcome_unknown');
    }
    if(!files.length)throw new OperationError(t('agent.pdfExportIncomplete'));
    const documents=await processPdfs(op,files,{render_pages:args.render_pages||[],max_pages:args.max_pages||5000});
    const mapping=matchLayoutPages(layouts,documents.pages,sets.flatMap(set=>set.items));
    const coverage={layouts:layouts.length,matched:mapping.filter(item=>item.status==='matched').length,ambiguous:mapping.filter(item=>item.status==='ambiguous').length,missing:mapping.filter(item=>item.status==='missing').length,...documents.coverage};
    const manifest=await op.save('package.json',{registry,outputs,coverage,mapping,documents:`${op.relative}/document.json`});
    op.manifest.checks.push('pdf_file_headers','layout_registry_to_page_matching');
    const partial=!layouts.length||outputs.some(output=>output.isError)||documents.errors.length||mapping.some(item=>item.status!=='matched')||coverage.expected_pages!==coverage.processed_pages;
    return {status:partial?'partial':'completed',saved:manifest,registry,files:files.map(file=>file.label),coverage,unresolved:mapping.filter(item=>item.status!=='matched'),previews:documents.pages.filter(page=>page.preview).map(page=>({source:page.source,page:page.page,path:`${op.relative}/${page.preview}`})),
      mappingScope:'Textual number-and-title matches with ambiguity checks; not independent proof that a PDF page came from a specific layout.',visualReview:'not_performed'};
  });
}

function markdownEscape(text){return String(text??'').replace(/[\\`*_{}\[\]()<>#+.!|~-]/g,'\\$&').replace(/[\r\n]+/g,' ');}
export async function auditLayoutText(context,args={}) {
  return runOperation(context,'audit_layout_text',args,async op=>{
    if(!Array.isArray(args.files)||!args.files.length)throw new OperationError(t('operations.invalidInput',{field:'files'}));
    const files=[];
    for(const label of [...new Set(args.files)]){
      const location=await op.store.resolveFile(op.session.projectId,op.session.id,label,{});
      const stat=await fs.stat(location.file);
      if(!stat.isFile()||stat.size>256*1024*1024)throw new OperationError(t('operations.invalidInput',{field:label}));
      files.push({label,path:location.file});
    }
    const report=await processPdfs(op,files,{audit:true,spellcheck:args.spellcheck!==false,languages:args.languages||['ru','en'],glossary:args.glossary||[],replacements:args.replacements||[],ocr:args.ocr===true,render_pages:args.render_pages||[],max_pages:args.max_pages||5000,max_findings:args.max_findings||5000});
    const unavailable=Object.values(report.spellcheck).some(value=>String(value).startsWith('unavailable'));
    const partial=report.errors.length||report.findings_truncated||unavailable||report.coverage.processed_pages!==report.coverage.expected_pages||report.coverage.image_text_unreviewed_pages>0||report.pages.some(page=>page.text_status==='no_extractable_text');
    const heading=t('operations.auditTitle'),notice=t('operations.auditNotice');
    const rows=report.findings.map(finding=>`| ${markdownEscape(finding.source)} | ${finding.page} | ${markdownEscape(finding.kind)} | ${markdownEscape(finding.text)} | ${markdownEscape(Array.isArray(finding.suggestion)?finding.suggestion.join(', '):finding.suggestion)} |`);
    const markdown=`# ${heading}\n\n${notice}\n\n${t('operations.auditCoverage',{processed:report.coverage.processed_pages,expected:report.coverage.expected_pages,images:report.coverage.image_text_unreviewed_pages})}\n\n| ${t('operations.auditColumns')} |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}\n`;
    await fs.writeFile(path.join(op.directory,'report.md'),markdown,'utf8');
    op.manifest.checks.push('mixed_script_detection','repeated_word_detection','explicit_term_replacements');
    if(!unavailable&&args.spellcheck!==false)op.manifest.checks.push('offline_dictionary_lookup');
    return {status:partial?'partial':'completed',saved:`${op.relative}/document.json`,report:`${op.relative}/report.md`,coverage:report.coverage,spellcheck:report.spellcheck,findings:report.findings.length,findingsTruncated:report.findings_truncated,sample:report.findings.slice(0,10),errors:report.errors,previews:report.pages.filter(page=>page.preview).map(page=>({source:page.source,page:page.page,path:`${op.relative}/${page.preview}`})),
      interpretation:'Candidates for review, not confirmed errors. Proper names, abbreviations and technical terms may be valid. No model or PDF contents were changed. Visual coverage is separate.'};
  });
}

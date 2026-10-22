import { t } from '../locales/index.mjs';

export function resultData(result) {
  if(result?.structuredContent!==undefined)return result.structuredContent;
  const text=result?.content?.length===1 && result.content[0].type==='text'?result.content[0].text:undefined;
  if(text!==undefined){try{return JSON.parse(text);}catch{return text;}}
  return result;
}

export function toolSummary(name,args,result) {
  const command=name==='call_archicad'?String(args?.name||'').split(':').pop():name;
  const data=resultData(result);
  if(result?.isError) {
    const error=result.error || (name==='run_python'?t('agent.pythonExited',{code:result.exitCode??'unknown'}):typeof data==='string'?data:undefined) || t('agent.openToolError');
    return t('agent.toolFailed',{command,error:String(error).slice(0,280)});
  }
  if(name==='list_files' && Array.isArray(data))return t('agent.filesFound',{count:data.length,path:args.path||'.'});
  if(name==='list_files' && Array.isArray(data?.entries))return t('agent.filesFound',{count:data.total,path:`${t(data.scope==='project'?'ui.projectFiles':'ui.chatFiles')}: ${data.path}`});
  if(name==='write_file' && data?.saved)return t('agent.fileSaved',{path:data.saved});
  if(name==='export_layouts_pdf' && data?.pdfs?.length)return t('agent.pdfsExported',{count:data.pdfs.length,path:data.outputDirectory});
  if(name!=='call_archicad' || !data || typeof data!=='object')return;
  if(command==='TestConnection' && data.archicad_version)return t('agent.connectionConfirmed',{version:data.archicad_version});
  if(command==='GetProjectInfo') {
    const project=data.projectName||data.name||data.projectPath?.split(/[\\/]/).pop()||data.projectLocation?.split(/[\\/]/).pop();
    if(project)return t('agent.projectConfirmed',{project});
  }
  if(command==='GetNavigatorItemTree' && data.navigatorItemTree) {
    const pending=[data.navigatorItemTree];let count=0,layouts=0;
    while(pending.length){const node=pending.pop();count++;if(node.type==='LayoutItem')layouts++;for(const child of node.children||[])pending.push(child.navigatorItem||child);}
    return layouts?t('agent.layoutsFound',{count:layouts}):t('agent.navigatorItemsFound',{count});
  }
  const lists={GetStories:['stories','agent.storiesFound'],GetElementsByType:['elements','agent.elementsFound']};
  const list=lists[command];
  if(list && Array.isArray(data[list[0]]))return t(list[1],{count:data[list[0]].length,type:args.arguments?.elementType||''});
}

export function recoveryHint(name) {
  return name==='run_python'
    ? 'Inspect error, termination, stderr and the full log before another script; stdout progress is not a failure reason. For missing files, list their actual directory and scope rather than guessing another path. Python cwd is the chat workspace; original inputs are under ARCHI_PROJECT_DIR and migrated service results under ARCHI_LEGACY_DIR. Verify that every prerequisite exists before a mutation. For timeout/cancellation the outcome may be unknown: inspect state first, then use bounded smaller batches and checkpoints, or a justified timeout_seconds. Use get_api_catalog for exact schemas and prefer discovered call_archicad commands. Probe imports before using optional libraries. After two failures with the same approach, explain and use a different approach. Never replay a mutation with an unknown outcome.'
    : 'Inspect the actual error. For an Archicad command, search find_tools with its exact name and follow the returned inputSchema. Do not guess argument names or response fields. After two failures with the same approach, explain and use a different approach. Never replay a mutation with an unknown outcome.';
}

import {catalogs,t} from '../locales/index.mjs';
import {toolSummary} from '../electron/progress.mjs';

export function visibleMessages(messages,showTools=false) {
  const prefixes=Object.values(catalogs).map(catalog=>catalog['knowledge.automaticAttached'].split('{titles}')[0]);
  return messages.flatMap(message=>{
    if(message.role==='notice'&&prefixes.some(prefix=>message.text?.startsWith(prefix)))return [];
    if(showTools||message.role!=='tool')return [message];
    if(message.status!=='error')return [];
    let result;try{result=JSON.parse(message.text);}catch{result={error:message.text};}
    return [{...message,role:'notice',text:message.summary||toolSummary(message.name,message.args,{...result,isError:true})||t('ui.toolActionFailed')}];
  });
}

export function activityLabel(messages,approval=false) {
  if(approval)return t('activity.approval');
  const last=messages.at(-1);
  if(last?.role!=='tool'||last.status!=='running')return t(last?.role==='tool'?'activity.results':'activity.thinking');
  const args=last.args&&typeof last.args==='object'?last.args:{};
  if(typeof args.purpose==='string'&&args.purpose.trim())return args.purpose.trim().slice(0,180);
  const stages={get_knowledge:'knowledge',get_api_catalog:'catalog',find_tools:'catalog',export_layouts_pdf:'export',list_files:'files',read_file:'reading',view_image:'image',show_image:'image',write_file:'writing',run_python:'python'};
  if(stages[last.name])return t(`activity.${stages[last.name]}`);
  const command=String(args.name||last.name||'').split(':').pop();
  const commands={TestConnection:'connection',GetProjectInfo:'project',GetNavigatorItemTree:'navigator',GetElementsByType:'elements',GetSelectedElements:'elements',GetQuantitiesOfElements:'quantities',GetPropertyValuesOfElements:'properties',GetPropertiesOfElements:'properties',GetLayoutSettings:'layouts',GetPublisherSetNames:'publishers',PublishPublisherSet:'export'};
  return t(commands[command]?`activity.${commands[command]}`:'activity.command',{command});
}

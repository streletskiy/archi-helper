import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, ChevronRight, Copy, FileText, FolderOpen, Plus, RefreshCw, Search, Sparkles, Trash2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { t } from './i18n';
import './knowledge.css';

export type KnowledgeSelection={id:string;title:string};
type Entry={id?:string;title:string;summary:string;text?:string;kind:'knowledge'|'skill';activation:'auto'|'manual'|'always';scope:'global'|'project'|'system';enabled:boolean;tags:string[];archicad:number[];source?:string;revision?:string;relative?:string;applicable?:boolean;archived?:boolean;pinned?:boolean;confidence?:'candidate'|'observed';archive?:{reason:string;articleId?:string}};
type Library={entries:Entry[];issues:{file:string;error:string}[];root:string;connection:{archicad:number|null}};
const api=(method:string,input?:unknown)=>window.archi.call(method,input);
const blank=():Entry=>({title:'',summary:'',text:'',kind:'knowledge',activation:'auto',scope:'global',enabled:true,tags:[],archicad:[],source:'user'});

export function KnowledgeLibrary({projectId,projectName,selected,onSelected,onClose}:{projectId:string;projectName:string;selected:KnowledgeSelection[];onSelected:(value:KnowledgeSelection[])=>void;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),[library,setLibrary]=useState<Library|null>(null),[entry,setEntry]=useState<Entry|null>(null),[baseline,setBaseline]=useState('');
  const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[editing,setEditing]=useState(false),[preview,setPreview]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [tags,setTags]=useState(''),[versions,setVersions]=useState(''),[confirmation,setConfirmation]=useState<{text:string;action:()=>void}|null>(null);
  const serial=JSON.stringify({entry,tags,versions}),dirty=editing&&serial!==baseline;
  const writable=entry?.source==='user',prompt=entry?.id==='system-prompt';
  const refresh=async()=>{const next=await api('knowledgeList',{projectId});setLibrary(next);return next as Library;};
  const run=async(action:()=>Promise<void>)=>{setPending(true);setError('');setNotice('');try{await action();}catch(error){setError((error as Error).message);}finally{setPending(false);}};
  const replace=(next:Entry,edit=false)=>{setEntry(next);setTags(next.tags.join(', '));setVersions(next.archicad.join(', '));setBaseline(JSON.stringify({entry:next,tags:next.tags.join(', '),versions:next.archicad.join(', ')}));setEditing(edit);setPreview(false);setError('');};
  const navigate=(action:()=>void)=>{if(pending)return;if(dirty)setConfirmation({text:t('knowledge.unsaved'),action});else action();};
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();void run(async()=>{await refresh();});return()=>{dialog.current?.close();previous?.focus();};},[]);
  const open=(item:Entry)=>navigate(()=>void run(async()=>replace(await api('knowledgeRead',{projectId,id:item.id}))));
  const save=()=>void run(async()=>{
    if(!entry)return;
    const next=await api('knowledgeSave',{projectId,entry:{...entry,tags:tags.split(',').map(value=>value.trim()).filter(Boolean),archicad:versions.split(',').map(value=>value.trim()).filter(Boolean).map(Number)}});
    if(entry.id&&selected.some(item=>item.id===entry.id))onSelected(selected.map(item=>item.id===entry.id?{id:next.id,title:next.title}:item));
    await refresh();replace(next);setNotice(t('knowledge.saved'));
  });
  const attach=()=>{
    if(!entry?.id)return;
    if(selected.some(item=>item.id===entry.id))onSelected(selected.filter(item=>item.id!==entry.id));
    else if(selected.length<8){onSelected([...selected,{id:entry.id,title:entry.title}]);setNotice(t('knowledge.selection',{count:selected.length+1}));}
    else setError(t('knowledge.selectionLimit'));
  };
  const updateFinding=(patch:{enabled?:boolean;pinned?:boolean;archived?:boolean})=>void run(async()=>{
    const next=await api('findingUpdate',{projectId,id:entry?.id,revision:entry?.revision,...patch});
    onSelected(selected.filter(item=>item.id!==entry?.id));await refresh();replace(next);
  });
  const visible=library?.entries.filter(item=>(filter==='archive'?item.archived:!item.archived&&(filter==='all'||filter==='mine'&&item.source==='user'||filter==='system'&&item.source==='bundled'||filter==='project'&&item.scope==='project'||filter==='findings'&&item.source==='agent'))&&`${item.title} ${item.summary} ${item.tags.join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))||[];
  const update=(patch:Partial<Entry>)=>setEntry(current=>current?{...current,...patch}:current);
  return <dialog ref={dialog} className="knowledge-dialog" aria-labelledby="knowledge-heading" onCancel={event=>{event.preventDefault();navigate(onClose);}} onKeyDown={event=>{if(event.key==='Escape')event.stopPropagation();}}>
    <header className="knowledge-header"><div className="knowledge-emblem"><BookOpen size={25}/></div><div><h2 id="knowledge-heading">{t('knowledge.title')}</h2><p>{t('knowledge.subtitle')}</p></div><button className="icon-button" aria-label={t('ui.closeDialog')} disabled={pending} onClick={()=>navigate(onClose)}><X size={20}/></button></header>
    <div className="knowledge-layout"><aside className="knowledge-sidebar">
      <button className="primary knowledge-new" disabled={pending} onClick={()=>navigate(()=>replace(blank(),true))}><Plus size={17}/>{t('knowledge.new')}</button>
      <label className="knowledge-search"><Search size={16}/><input aria-label={t('knowledge.search')} placeholder={t('knowledge.search')} value={query} onChange={event=>setQuery(event.target.value)}/></label>
      <nav className="knowledge-filters" aria-label={t('knowledge.scope')}>{(['all','mine','project','system','findings','archive'] as const).map(value=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{t(`knowledge.${value}`)}</button>)}</nav>
      <div className="knowledge-list">{visible.map(item=><button key={item.id} className={entry?.id===item.id?'selected':''} onClick={()=>open(item)} disabled={pending}>
        <span className="knowledge-list-icon">{item.kind==='skill'?<Sparkles size={17}/>:<FileText size={17}/>}</span><span><strong>{item.title}</strong><small>{t(item.source==='agent'?'knowledge.findings':item.source==='bundled'?'knowledge.system':item.scope==='project'?'knowledge.project':'knowledge.global')} · {t(item.archived?'knowledge.archive':`knowledge.${item.enabled?item.activation:'disabled'}`)}</small></span>{selected.some(chosen=>chosen.id===item.id)?<Check size={15}/>:<ChevronRight size={13}/>}</button>)}
        {!visible.length&&<div className="knowledge-empty"><BookOpen size={28}/><strong>{t(library?.entries.length?'knowledge.noResults':'knowledge.empty')}</strong><p>{t('knowledge.emptyHint')}</p></div>}
      </div>
      <div className="knowledge-library-actions"><button onClick={()=>navigate(()=>void run(async()=>{await refresh();if(entry?.id&&!prompt)replace(await api('knowledgeRead',{projectId,id:entry.id}));}))} disabled={pending}><RefreshCw size={15}/>{t('knowledge.refresh')}</button><button onClick={()=>void run(async()=>{await api('knowledgeFolder',{source:entry?.source==='agent'||filter==='findings'||filter==='archive'?'agent':'user'});})} disabled={pending}><FolderOpen size={15}/>{t('knowledge.folder')}</button><button onClick={()=>navigate(()=>void run(async()=>{const result=await api('knowledgePrompt');replace({...blank(),id:'system-prompt',title:t('knowledge.prompt'),summary:t('knowledge.promptHint'),text:result.text,source:'bundled',scope:'system'});} ))} disabled={pending}><FileText size={15}/>{t('knowledge.prompt')}</button></div>
    </aside><main className="knowledge-detail">
      {error&&<p className="knowledge-error" role="alert">{error}</p>}{notice&&<p className="knowledge-notice" role="status">{notice}</p>}
      {!!library?.issues.length&&<details className="knowledge-error"><summary>{t('knowledge.issues')} ({library.issues.length})</summary>{library.issues.map(issue=><p key={issue.file}>{issue.file}: {issue.error}</p>)}</details>}
      {!entry?<div className="knowledge-intro"><div className="knowledge-intro-icon"><BookOpen size={38}/><Sparkles size={20}/></div><h3>{t('knowledge.budget')}</h3><p>{t('knowledge.budgetHint')}</p><div className="knowledge-mode-cards">{(['auto','manual','always'] as const).map(mode=><div key={mode}><strong>{t(`knowledge.${mode}`)}</strong><p>{t(`knowledge.${mode}Hint`)}</p></div>)}</div><p>{t('knowledge.pick')}</p></div>:<>
        {!editing?<><div className="knowledge-entry-heading"><span className="knowledge-badge">{prompt?t('knowledge.prompt'):t(`knowledge.${entry.kind}`)}</span><span className="knowledge-badge subtle">{t(`knowledge.${entry.activation}`)}</span></div><h3 className="knowledge-entry-title">{entry.title}</h3><p className="knowledge-summary">{entry.summary}</p>
          <div className="knowledge-entry-meta"><span>{entry.source==='bundled'?t('knowledge.readonly'):entry.scope==='project'?projectName:t('knowledge.global')}</span>{!!entry.archicad.length&&<span>Archicad {entry.archicad.join(', ')}</span>}{!entry.enabled&&<span>{t('knowledge.disabled')}</span>}</div>
          {entry.applicable===false&&<p className="knowledge-warning">{t('knowledge.versionMismatch')}</p>}
          {entry.source==='agent'&&<><p className="knowledge-warning">{t('findings.reference')} {t(`findings.${entry.confidence||'candidate'}`)}</p>
            {entry.archive?.articleId&&<p className="knowledge-summary">{t('findings.replacedBy',{id:entry.archive.articleId})}</p>}
            <div className="knowledge-entry-actions"><button className="secondary" disabled={pending} onClick={()=>updateFinding(entry.archived?{archived:false}:{enabled:!entry.enabled})}>{t(entry.archived?'findings.restore':entry.enabled?'findings.disable':'findings.enable')}</button>
              {!entry.archived&&<><button className="secondary" disabled={pending} onClick={()=>updateFinding({pinned:!entry.pinned})}>{t(entry.pinned?'findings.unpin':'findings.pin')}</button><button className="secondary" disabled={pending} onClick={()=>updateFinding({archived:true})}>{t('findings.archive')}</button></>}
            </div></>}
          <div className="knowledge-entry-actions">{writable?<button className="secondary" onClick={()=>setEditing(true)}>{t('knowledge.edit')}</button>:!prompt&&<button className="secondary" onClick={()=>replace({...entry,id:undefined,revision:undefined,source:'user',scope:'global',activation:'auto'},true)}><Copy size={15}/>{t('knowledge.copy')}</button>}{!prompt&&<button className="primary" disabled={!entry.enabled||entry.applicable===false||pending} onClick={attach}>{selected.some(item=>item.id===entry.id)?<Check size={15}/>:<Plus size={15}/>} {t(selected.some(item=>item.id===entry.id)?'knowledge.detach':'knowledge.attach')}</button>}</div>
          <article className="prose knowledge-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{img:({alt})=><span>{alt}</span>}}>{entry.text||''}</ReactMarkdown></article>
          {entry.relative&&<details className="knowledge-file"><summary>{t('knowledge.storageDetails')}</summary><code>{entry.relative}</code></details>}
        </>:<form id="knowledge-editor" className="knowledge-form" inert={pending} onSubmit={event=>{event.preventDefault();save();}}>
          <div className="knowledge-form-heading"><h3>{t(entry.id?'knowledge.edit':'knowledge.new')}</h3><label className="knowledge-enabled"><input type="checkbox" checked={entry.enabled} onChange={event=>update({enabled:event.target.checked})}/>{t('knowledge.enabled')}</label></div>
          <label>{t('knowledge.name')}<input required maxLength={120} value={entry.title} onChange={event=>update({title:event.target.value})}/></label>
          <label>{t('knowledge.summary')}<input required maxLength={320} value={entry.summary} onChange={event=>update({summary:event.target.value})}/></label>
          <div className="knowledge-fields"><label>{t('knowledge.kind')}<select value={entry.kind} onChange={event=>update({kind:event.target.value as Entry['kind']})}><option value="knowledge">{t('knowledge.knowledge')}</option><option value="skill">{t('knowledge.skill')}</option></select></label><label>{t('knowledge.scope')}<select value={entry.scope} onChange={event=>update({scope:event.target.value as Entry['scope']})}><option value="global">{t('knowledge.global')}</option><option value="project">{projectName}</option></select></label><label>{t('knowledge.activation')}<select value={entry.activation} onChange={event=>update({activation:event.target.value as Entry['activation']})}>{(['auto','manual','always'] as const).map(value=><option key={value} value={value}>{t(`knowledge.${value}`)}</option>)}</select></label></div>
          <p className="knowledge-activation-hint">{t(`knowledge.${entry.activation}Hint`)}</p>
          <div className="knowledge-fields two"><label>{t('knowledge.tags')}<input value={tags} onChange={event=>setTags(event.target.value)}/></label><label>{t('knowledge.versions')}<input value={versions} placeholder={t('knowledge.versionsHint')} onChange={event=>setVersions(event.target.value)}/></label></div>
          <div className="knowledge-body-heading"><label htmlFor="knowledge-body">{t('knowledge.body')}</label><button type="button" className="text-button" onClick={()=>setPreview(value=>!value)}>{t(preview?'knowledge.edit':'knowledge.preview')}</button></div>
          {preview?<article className="prose knowledge-markdown preview"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{img:({alt})=><span>{alt}</span>}}>{entry.text||''}</ReactMarkdown></article>:<textarea id="knowledge-body" required rows={9} maxLength={24000} value={entry.text} onChange={event=>update({text:event.target.value})}/>}
          <small className="knowledge-token-estimate">{t('knowledge.chars',{count:entry.text?.length||0,limit:entry.activation==='always'?2000:24000})}</small>
          <div className="knowledge-save-actions">{entry.id&&<button type="button" className="text-button danger-text" disabled={pending} onClick={()=>setConfirmation({text:t('knowledge.removeConfirm'),action:()=>void run(async()=>{await api('knowledgeRemove',{projectId,id:entry.id,revision:entry.revision});onSelected(selected.filter(item=>item.id!==entry.id));setEntry(null);setEditing(false);await refresh();setNotice(t('knowledge.removed'));})})}><Trash2 size={15}/>{t('knowledge.remove')}</button>}<button type="button" className="secondary" disabled={pending} onClick={()=>navigate(()=>{if(entry.id)void run(async()=>replace(await api('knowledgeRead',{projectId,id:entry.id})));else{setEntry(null);setEditing(false);}})}>{t('knowledge.cancel')}</button></div>
        </form>}
      </>}
    </main></div>
    {confirmation&&<div className="knowledge-confirm" role="alert"><span>{confirmation.text}</span><button className="secondary" onClick={()=>setConfirmation(null)}>{t('knowledge.cancel')}</button><button className="primary" onClick={()=>{const action=confirmation.action;setConfirmation(null);action();}}>{t(confirmation.text===t('knowledge.removeConfirm')?'knowledge.remove':'knowledge.discard')}</button></div>}
    <footer className="knowledge-footer"><div><strong>{t('knowledge.selection',{count:selected.length})}</strong><p>{t('knowledge.storageHint')}</p></div>{editing&&entry&&<button type="submit" form="knowledge-editor" className="primary" disabled={pending||!entry.title.trim()||!entry.summary.trim()||!entry.text?.trim()}><Check size={15}/>{t('knowledge.save')}</button>}<button className="secondary" disabled={pending} onClick={()=>navigate(onClose)}>{t('knowledge.done')}</button></footer>
  </dialog>;
}

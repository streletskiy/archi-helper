import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent } from 'react';
import { BookOpen, Check, Search, Sparkles } from 'lucide-react';
import { t } from './i18n';
import type { KnowledgeSelection } from './KnowledgeLibrary';

type Candidate=KnowledgeSelection&{summary:string;tags:string[];kind:string;enabled:boolean;applicable:boolean;activation:'auto'|'manual'|'always'};
export type KnowledgeSlashHandle={keyDown:(event:KeyboardEvent<HTMLTextAreaElement>)=>boolean};

export const KnowledgeSlash=forwardRef<KnowledgeSlashHandle,{projectId:string;query:string;selected:KnowledgeSelection[];onSelect:(entry:KnowledgeSelection)=>void;onDismiss:()=>void;onActive:(id:string|undefined)=>void}>(function KnowledgeSlash({projectId,query,selected,onSelect,onDismiss,onActive},ref) {
  const [entries,setEntries]=useState<Candidate[]>([]),[index,setIndex]=useState(0),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const list=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    let disposed=false;setLoading(true);setError('');
    window.archi.call('knowledgeList',{projectId}).then(result=>{if(!disposed)setEntries(result.entries.filter((entry:Candidate)=>entry.enabled&&entry.applicable));},error=>{if(!disposed)setError(error.message);}).finally(()=>{if(!disposed)setLoading(false);});
    return()=>{disposed=true;};
  },[projectId]);
  const words=query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const results=entries.filter(entry=>!selected.some(item=>item.id===entry.id)&&words.every(word=>`${entry.title} ${entry.summary} ${entry.tags.join(' ')}`.toLocaleLowerCase().includes(word))).slice(0,30);
  const current=Math.min(index,Math.max(0,results.length-1)),limited=selected.length>=8;
  useEffect(()=>setIndex(0),[query]);
  useEffect(()=>{const id=results.length&&!limited?`knowledge-option-${current}`:undefined;onActive(id);if(id)list.current?.querySelector(`#${id}`)?.scrollIntoView({block:'nearest'});return()=>onActive(undefined);},[current,results.length,limited,onActive]);
  const choose=(entry:Candidate)=>{if(!limited)onSelect({id:entry.id,title:entry.title});};
  useImperativeHandle(ref,()=>({keyDown:event=>{
    if(event.nativeEvent.isComposing)return false;
    if(event.key==='Escape'){onDismiss();return true;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){setIndex(value=>results.length?(value+(event.key==='ArrowDown'?1:-1)+results.length)%results.length:0);return true;}
    if(event.key==='Tab'&&(!results[current]||limited)){onDismiss();return false;}
    if(event.key==='Enter'||event.key==='Tab'){if(results[current])choose(results[current]);return true;}
    return false;
  }}));
  return <div className="knowledge-slash" onMouseDown={event=>event.preventDefault()}>
    <div className="knowledge-slash-heading"><BookOpen size={16}/><strong>{t('knowledge.choose')}</strong><kbd>/</kbd></div>
    <div id="knowledge-suggestions" className="knowledge-slash-list" role="listbox" aria-label={t('knowledge.choose')} ref={list}>
      {limited?<p role="status">{t('knowledge.selectionLimit')}</p>:error?<p role="alert">{error}</p>:loading?<p role="status">{t('knowledge.loading')}</p>:results.length?results.map((entry,position)=><button key={entry.id} id={`knowledge-option-${position}`} type="button" role="option" aria-selected={position===current} tabIndex={-1} onMouseEnter={()=>setIndex(position)} onClick={()=>choose(entry)}>{entry.kind==='skill'?<Sparkles size={17}/>:<BookOpen size={17}/>}<span><strong>{entry.title}</strong><small>{entry.summary}</small></span>{position===current&&<Check size={15}/>}</button>):<p>{t('knowledge.noResults')}</p>}
    </div>
    <div className="knowledge-slash-footer"><Search size={13}/><span>{t('knowledge.slashHint')}</span><kbd>↑↓</kbd><kbd>Enter</kbd><kbd>Esc</kbd></div>
  </div>;
});

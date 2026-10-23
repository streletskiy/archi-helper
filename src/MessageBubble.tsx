import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Check,Copy} from 'lucide-react';
import {t,useLanguage} from './i18n';
import './chat.css';

export function MessageBubble({role,text,at,streaming=false,onCopy,children}:{role:string;text:string;at?:number;streaming?:boolean;onCopy:(text:string)=>Promise<boolean>;children:ReactNode}){
  const language=useLanguage(),[copied,setCopied]=useState(false),reset=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useEffect(()=>()=>clearTimeout(reset.current),[]);
  const assistant=role==='assistant',user=role==='user';
  const copy=async()=>{if(await onCopy(text)){setCopied(true);clearTimeout(reset.current);reset.current=setTimeout(()=>setCopied(false),2000);}};
  return <article className={`message chat-message ${role}`} aria-label={assistant?'Archi Helper':t(user?'ui.you':'ui.pleaseNote')}>
    {assistant&&<img className="message-helmet" src="./helmet.png" alt="" width="48" height="48"/>}
    <div className="message-body">
      {assistant&&<div className="message-label">Archi Helper{streaming&&<span className="thinking-dot" aria-label={t('ui.working')}/>}</div>}
      <div className="message-bubble prose">{children}</div>
      {(assistant||user)&&<footer className="message-footer">
        {at&&Number.isFinite(at)&&<time dateTime={new Date(at).toISOString()}>{new Intl.DateTimeFormat(language,{hour:'2-digit',minute:'2-digit'}).format(at)}</time>}
        <button className={`message-copy ${copied?'is-copied':''}`} title={t('ui.copyMessage')} aria-label={t(user?'ui.copyYourMessage':'ui.copyAssistantMessage')} disabled={!text} onClick={copy}>{copied?<Check size={14}/>:<Copy size={14}/>}<span>{t(copied?'ui.copied':'ui.copy')}</span></button>
      </footer>}
    </div>
  </article>;
}

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, ShieldCheck, X } from 'lucide-react';
import { t } from './i18n';
import type { TranslationKey } from '../locales/index.mjs';
import { providerDefinitions } from '../electron/provider-definitions.mjs';

export type ProviderPromptData={id:string;kind:'info'|'remove'|'account';definitionId?:string;message:string;detail:string;buttons:string[];defaultId:number;cancelId:number};
export type ClaudeProgress={stage:'detecting'|'downloading'|'verifying'|'installing'|'checking'|'authorizing';percent?:number};
const claudeStages:Record<ClaudeProgress['stage'],TranslationKey>={detecting:'claude.detecting',downloading:'claude.downloading',verifying:'claude.verifying',installing:'claude.installing',checking:'claude.checking',authorizing:'claude.authorizing'};
type ConnectionDefinition={id:string;name:string;logo?:string;logoMonochrome?:boolean;connectLabel?:TranslationKey};
const claudeDefinition=providerDefinitions.find(def=>def.id==='claude-code')!;

function ConnectButton({definition,reconnecting,disabled,onClick}:{definition:ConnectionDefinition;reconnecting?:boolean;disabled:boolean;onClick:()=>void}) {
  return <button className="secondary oauth-sign-in" disabled={disabled} onClick={onClick}>{definition.logo?<img className={definition.logoMonochrome?'oauth-logo monochrome':'oauth-logo'} src={definition.logo} alt="" width={24} height={24}/>:<ExternalLink size={24}/>}<span>{t(definition.connectLabel||(reconnecting?'ui.oauthReconnectProvider':'ui.oauthConnectProvider'),{name:definition.name})}</span></button>;
}

export function ClaudeConnect({disabled,progress,settings=false,onBusy,onState,onConnected}:{disabled:boolean;progress?:ClaudeProgress|null;settings?:boolean;onBusy:(busy:boolean)=>void;onState:(state:any)=>void;onConnected:(result:{providerId:string;state:any})=>Promise<void>}) {
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  const active=pending||!!progress;
  async function connect(options={}) {
    setPending(true);setError('');onBusy(true);
    try {await onConnected(await window.archi.call('connectClaude',options));}
    catch(error){setError((error as Error).message);try{onState(await window.archi.call('bootstrap'));}catch{}}
    finally {setPending(false);onBusy(false);}
  }
  return <div className="oauth-connect">
    <div className="oauth-controls"><ConnectButton definition={claudeDefinition} disabled={disabled||active} onClick={()=>connect()}/>
      {active&&<button className="secondary" onClick={()=>window.archi.call('cancelClaude')}><X size={16}/>{t('ui.cancel')}</button>}</div>
    {active&&<p role="status" className="oauth-message">{t(claudeStages[progress?.stage||'detecting'])}{progress?.stage==='downloading'&&progress.percent!==undefined?` ${progress.percent}%`:''}</p>}
    {progress?.stage==='downloading'&&<progress aria-label={t('claude.downloading')} max={100} value={progress.percent} style={{width:'100%'}}/>}
    {error&&<p role="alert" className="oauth-message oauth-error">{error}</p>}
    {settings&&<div className="settings-advanced-content">
      <p>{t('claude.description')}</p><p>{t('claude.setupHint')}</p><div className="oauth-controls">
        <button className="secondary" onClick={()=>window.archi.call('external',{url:'https://code.claude.com/docs/en/setup'})}>{t('claude.install')}<ExternalLink size={14}/></button>
        <button className="secondary" disabled={disabled||active} onClick={()=>connect({chooseExecutable:true})}>{t('claude.chooseExecutable')}</button>
        <button className="secondary" disabled={disabled||active} onClick={()=>connect({login:true})}>{t('claude.switchAccount')}</button>
        <button className="secondary" disabled={disabled||active} onClick={()=>connect({login:true,consoleLogin:true})}>{t('claude.consoleLogin')}</button>
        <button className="secondary" disabled={disabled||active} onClick={()=>connect({allowOtherAuth:true})}>{t('claude.currentAuth')}</button>
      </div></div>}
  </div>;
}

export function ProviderPrompt({prompt}:{prompt:ProviderPromptData}) {
  const ref=useRef<HTMLDialogElement>(null),[pending,setPending]=useState(false),[error,setError]=useState('');
  const definition=providerDefinitions.find(item=>item.id===prompt.definitionId);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null,dialog=ref.current!;
    dialog.showModal();dialog.querySelector<HTMLButtonElement>(`[data-response="${prompt.defaultId}"]`)?.focus();
    return()=>{dialog.close();previous?.focus();};
  },[prompt.id]);
  async function answer(response:number) {
    if(pending)return;setPending(true);setError('');
    try {await window.archi.call('answerProviderPrompt',{id:prompt.id,response});}
    catch(error){setError((error as Error).message);setPending(false);}
  }
  return <dialog ref={ref} className={`provider-prompt ${prompt.kind}`} aria-labelledby="provider-prompt-title" aria-describedby="provider-prompt-description" onCancel={event=>{event.preventDefault();void answer(prompt.cancelId);}}>
    <div className="provider-prompt-heading"><span className="provider-prompt-symbol">{definition?.logo?<img className={definition.logoMonochrome?'oauth-logo monochrome':'oauth-logo'} src={definition.logo} width={28} height={28} alt=""/>:<ShieldCheck size={26}/>}</span><h2 id="provider-prompt-title">{prompt.message}</h2><button className="icon-button" aria-label={t('ui.closeDialog')} disabled={pending} onClick={()=>answer(prompt.cancelId)}><X size={18}/></button></div>
    <p id="provider-prompt-description">{prompt.detail}</p>
    {error&&<p className="oauth-message oauth-error" role="alert">{error}</p>}
    <div className="provider-prompt-actions">{prompt.buttons.map((label,index)=><button key={index} data-response={index} className={prompt.kind==='info'||prompt.kind==='remove'&&index!==prompt.cancelId?'primary':'secondary'} disabled={pending} onClick={()=>answer(index)}>{label}</button>)}</div>
  </dialog>;
}

export function OAuthConnect({definition,providerId,disabled,onBusy,onConnected,onState}:{
  definition:ConnectionDefinition;providerId?:string;disabled:boolean;
  onState?:(state:any)=>void;
  onBusy:(busy:boolean)=>void;onConnected:(result:{providerId:string;state:any})=>Promise<void>;
}) {
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  async function connect() {
    setError('');setPending(true);onBusy(true);
    try {
      const result=await window.archi.call('connectOAuth',{definitionId:definition.id,id:providerId});
      await onConnected(result);
    } catch(error) {setError((error as Error).message);try{onState?.(await window.archi.call('bootstrap'));}catch{}}
    finally {setPending(false);onBusy(false);}
  }
  return <div className="oauth-connect">
    <div className="oauth-controls"><ConnectButton definition={definition} reconnecting={!!providerId} disabled={disabled||pending} onClick={connect}/>
      {pending&&<button className="secondary" onClick={()=>window.archi.call('cancelOAuth')}><X size={16}/>{t('ui.cancel')}</button>}</div>
    {pending&&<p role="status" className="oauth-message">{t('ui.oauthWaiting')}</p>}
    {error&&<p role="alert" className="oauth-message oauth-error">{error}</p>}
  </div>;
}

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, ShieldCheck, X } from 'lucide-react';
import { t } from './i18n';
import type { TranslationKey } from '../locales/index.mjs';
import { providerDefinitions } from '../electron/provider-definitions.mjs';

export type ProviderPromptData={id:string;kind:'info'|'remove'|'account';definitionId?:string;message:string;detail:string;buttons:string[];defaultId:number;cancelId:number};

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
  definition:{id:string;name:string;logo?:string;logoMonochrome?:boolean;connectLabel?:TranslationKey};providerId?:string;disabled:boolean;
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
    <div className="oauth-controls"><button className="secondary oauth-sign-in" disabled={disabled||pending} onClick={connect}>{definition.logo?<img className={definition.logoMonochrome?'oauth-logo monochrome':'oauth-logo'} src={definition.logo} alt="" width={24} height={24}/>:<ExternalLink size={24}/>}<span>{t(definition.connectLabel||(providerId?'ui.oauthReconnectProvider':'ui.oauthConnectProvider'),{name:definition.name})}</span></button>
      {pending&&<button className="secondary" onClick={()=>window.archi.call('cancelOAuth')}><X size={16}/>{t('ui.cancel')}</button>}</div>
    {pending&&<p role="status" className="oauth-message">{t('ui.oauthWaiting')}</p>}
    {error&&<p role="alert" className="oauth-message oauth-error">{error}</p>}
  </div>;
}

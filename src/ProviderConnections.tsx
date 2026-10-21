import { useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { t } from './i18n';
import type { TranslationKey } from '../locales/index.mjs';

export function OAuthConnect({definition,providerId,disabled,onBusy,onConnected,onState,addAccount=false}:{
  definition:{id:string;name:string;logo?:string;connectLabel?:TranslationKey};providerId?:string;disabled:boolean;addAccount?:boolean;
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
    <div className="settings-control-row"><button className="secondary" disabled={disabled||pending} onClick={connect}>{definition.logo?<img src={definition.logo} alt="" width={24} height={24}/>:<ExternalLink size={16}/>}<span>{t(addAccount?'ui.addOAuthAccount':definition.connectLabel||(providerId?'ui.oauthReconnectProvider':'ui.oauthConnectProvider'),{name:definition.name})}</span></button>
      {pending&&<button className="secondary" onClick={()=>window.archi.call('cancelOAuth')}><X size={16}/>{t('ui.cancel')}</button>}</div>
    {pending&&<p role="status" className="settings-description">{t('ui.oauthWaiting')}</p>}
    {error&&<p role="alert" className="settings-description">{error}</p>}
  </div>;
}

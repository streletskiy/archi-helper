import {useEffect,useState,type ReactNode} from 'react';
import {Download,RotateCw} from 'lucide-react';
import {t} from './i18n';

type TapirUpdate={status:'available'|'current'|'not-installed'|'unknown';latestVersion:string;installedVersion:string};

export function TapirSettings({connection,disabled,active,onInstall,children}:{
  connection:{connected:boolean;data?:{tapir_installed?:string|boolean|null}}|undefined;
  disabled:boolean;active:boolean;onInstall:()=>void;children:ReactNode;
}) {
  const [update,setUpdate]=useState<TapirUpdate|null>(null),[checking,setChecking]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let cancelled=false;setChecking(true);setError('');setUpdate(null);
    window.archi.call('checkTapirUpdates').then((result:TapirUpdate)=>{if(!cancelled)setUpdate(result);})
      .catch((reason:Error)=>{if(!cancelled)setError(reason.message);})
      .finally(()=>{if(!cancelled)setChecking(false);});
    return()=>{cancelled=true;};
  },[connection,attempt]);
  const installed=connection?.connected?connection.data?.tapir_installed:undefined;
  const label=checking?'ui.checkingUpdates':update?.status==='available'?'ui.tapirUpdateAvailable':update?.status==='current'?'ui.youHaveTheLatestVersion':installed?'ui.installed':installed===false?'ui.notInstalled':'ui.statusUnknown';
  return <div className="settings-card">
    <div className="settings-card-title"><h4>{t('ui.tapirExtension')}</h4><span className={`settings-badge ${update?.status==='available'?'':'neutral'}`} role="status">{t(label)}</span></div>
    <p className="settings-description">{t('ui.tapirDescription')}</p>
    {typeof installed==='string'&&<p className="settings-description">{t('ui.tapirInstalledVersion',{version:installed})}</p>}
    {update&&<p className="settings-description" role="status">{t(update.status==='available'?'ui.tapirUpdateDescription':update.status==='unknown'?'ui.tapirVersionUnknown':'ui.tapirLatestVersion',{version:update.latestVersion})}</p>}
    {error&&<p className="oauth-message oauth-error" role="alert">{t('ui.tapirCheckFailed',{error})}</p>}
    <div className="settings-control-row tapir-actions">
      <button className="secondary" disabled={disabled||active||checking} onClick={()=>setAttempt(value=>value+1)}><RotateCw size={16} className={checking?'spin':undefined}/>{t(checking?'ui.checkingUpdates':'ui.checkForUpdates')}</button>
      {update?.status!=='current'&&<button className={update?.status==='available'?'primary':'secondary'} disabled={disabled||active||checking} onClick={onInstall}>{active?<RotateCw size={16} className="spin"/>:<Download size={16}/>} {t(active?'ui.downloading':update?.status==='available'?'ui.updateTapir':'ui.installTapir')}</button>}
    </div>
    {children}
  </div>;
}

import {useEffect,useState} from 'react';
import {ShieldCheck,ThumbsUp,ThumbsDown,HelpCircle} from 'lucide-react';
import {t} from './i18n';
import './telemetry.css';

export type TelemetryState={enabled:boolean;shareWorkflows:boolean;active:boolean;development:boolean;installationId?:string;queued:number;delivery:string};
type Observation={id:string;summary:{outcome:string;task_kind:string;tool_count:number;generation_count:number;duration_ms:number;[key:string]:unknown};steps:unknown[];feedback?:string;shared:boolean;coverage:string};

export function TelemetrySettings({value,onChange}:{value?:TelemetryState;onChange:(state:TelemetryState)=>void}) {
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  useEffect(()=>{let live=true;window.archi.call('telemetryStatus').then(state=>{if(live)onChange(state);}).catch(()=>{});return()=>{live=false;};},[]);
  async function update(input:{enabled?:boolean;shareWorkflows?:boolean}) {
    setPending(true);setError('');
    try{onChange(await window.archi.call('telemetryPreferences',input));}
    catch(error){setError((error as Error).message);try{onChange(await window.archi.call('telemetryStatus'));}catch{}}
    finally{setPending(false);}
  }
  return <section className="telemetry-settings" aria-labelledby="telemetry-heading">
    <h4 id="telemetry-heading"><ShieldCheck size={18}/>{t('telemetry.title')}</h4>
    <div className="settings-card chat-preference"><div><h4 id="telemetry-enabled">{t('telemetry.enabled')}</h4><p className="settings-description" id="telemetry-enabled-hint">{t('telemetry.enabledHint')}</p></div>
      <button className="settings-switch" role="switch" aria-checked={value?.enabled!==false} aria-labelledby="telemetry-enabled" aria-describedby="telemetry-enabled-hint" disabled={pending||!value} onClick={()=>update({enabled:!value?.enabled})}><span/></button></div>
    <div className="settings-card chat-preference"><div><h4 id="telemetry-workflows">{t('telemetry.workflows')}</h4><p className="settings-description" id="telemetry-workflows-hint">{t('telemetry.workflowsHint')}</p></div>
      <button className="settings-switch" role="switch" aria-checked={value?.enabled!==false&&value?.shareWorkflows!==false} aria-labelledby="telemetry-workflows" aria-describedby="telemetry-workflows-hint" disabled={pending||!value||!value.enabled} onClick={()=>update({shareWorkflows:!value?.shareWorkflows})}><span/></button></div>
    <p className="settings-description">{t('telemetry.exclusions')}</p>
    <p className="settings-description" role="status">{t(value?.development?'telemetry.development':value?.delivery==='storage_error'?'telemetry.saveFailed':!value?.enabled?'telemetry.off':value?.delivery==='unavailable'?'telemetry.unavailable':'telemetry.on')}</p>
    <details className="telemetry-details"><summary>{t('telemetry.details')}</summary><p>{t('telemetry.detailsHint')}</p><p>{t('telemetry.identifier')}: <code>{value?.installationId||'—'}</code></p><p>{t('telemetry.deletion')}</p></details>
    {error&&<p className="oauth-message oauth-error" role="alert">{error}</p>}
  </section>;
}

export function WorkflowReview({projectId,sessionId,busy}:{projectId:string;sessionId?:string;busy:boolean}) {
  const [runs,setRuns]=useState<Observation[]>([]),[pending,setPending]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    setRuns([]);setError('');if(!sessionId||busy)return;
    let live=true;
    window.archi.call('telemetryRuns',{projectId,sessionId}).then(value=>{if(live)setRuns(value);}).catch(()=>{});
    return()=>{live=false;};
  },[projectId,sessionId,busy]);
  const run=runs.at(-1);if(!run||busy)return null;
  async function rate(feedback:string) {
    setPending(true);setError('');
    try{setRuns(await window.archi.call('telemetryFeedback',{projectId,sessionId,id:run!.id,feedback}));}
    catch(error){setError((error as Error).message);}finally{setPending(false);}
  }
  return <details className="workflow-review"><summary>{t('telemetry.review')}</summary>
    <div className="workflow-review-content"><p>{t('telemetry.reviewHint')}</p>
      <div className="workflow-feedback" role="group" aria-label={t('telemetry.review')}>
        {([{value:'helpful',label:'telemetry.helpful',Icon:ThumbsUp},{value:'unhelpful',label:'telemetry.unhelpful',Icon:ThumbsDown},{value:'uncertain',label:'telemetry.uncertain',Icon:HelpCircle}] as const).map(({value,label,Icon})=><button className="secondary" key={value} disabled={pending} aria-pressed={run.feedback===value} onClick={()=>rate(value)}><Icon size={14}/>{t(label)}</button>)}
      </div>
      <p>{t(run.shared?'telemetry.routeQueued':'telemetry.routeNotShared')}</p>
      <details><summary>{t('telemetry.preview')}</summary><pre>{JSON.stringify({summary:run.summary,steps:run.steps,coverage:run.coverage},null,2)}</pre></details>
      {error&&<p className="oauth-message oauth-error" role="alert">{error}</p>}
    </div>
  </details>;
}

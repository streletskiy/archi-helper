import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Check,ChevronDown,ChevronRight,Download,FileText,Folder,Layers,LoaderCircle,Plug,RotateCw,ShieldCheck,Sparkles,X} from 'lucide-react';
import {t} from './i18n';
import {Mascot,type MascotAnimation} from './Mascot';
import './onboarding.css';

type Connection={connected?:boolean;message?:string;port?:string;data?:{port?:number;archicad_version?:string|number;tapir_installed?:boolean|string;tapir_definitions?:string}};
type Props={connection:Connection;runtimeReady:boolean;toolCount:number;providerName:string;port:string;tapirProgress?:{status:string;percent:number;message:string}|null;
  onProbe:(port?:string)=>Promise<void>;onScan:()=>Promise<{port:number}[]>;onInstall:()=>Promise<unknown>;onOpen:()=>Promise<unknown>;onFinish:(prompt?:string)=>Promise<void>};
const animations:MascotAnimation[]=['wave','inspect','measure','celebrate'];
const stepKeys=['ui.ftueStepWelcome','ui.ftueStepConnect','ui.ftueStepLearn','ui.ftueStepStart'] as const;

export function Onboarding({connection,runtimeReady,toolCount,providerName,port,tapirProgress,onProbe,onScan,onInstall,onOpen,onFinish}:Props){
  const [step,setStep]=useState(0),[leaving,setLeaving]=useState(false),[direction,setDirection]=useState(1),[pending,setPending]=useState(''),[error,setError]=useState(''),[selected,setSelected]=useState(0);
  const [chosenPort,setChosenPort]=useState(port),[instances,setInstances]=useState<{port:number}[]>([]);
  const dialog=useRef<HTMLElement>(null),headline=useRef<HTMLHeadingElement>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),probed=useRef(false),lock=useRef(false),finishing=useRef(false);
  const tapir=connection.connected&&!!connection.data?.tapir_installed;
  const ready=!!connection.connected&&tapir&&runtimeReady;
  const installing=!!tapirProgress&&['checking','downloading','verifying','installing'].includes(tapirProgress.status);
  const prompts=[t('ui.ftuePromptOverview'),t('ui.ftuePromptSelection'),t('ui.ftuePromptHelp')];
  const run=async(name:string,action:()=>Promise<unknown>)=>{
    if(lock.current)return;lock.current=true;setPending(name);setError('');
    try{await action();}catch(e){setError((e as Error).message);}finally{lock.current=false;setPending('');}
  };
  const finish=async(prompt?:string)=>{
    if(finishing.current)return;finishing.current=true;setPending('finish');setError('');
    try{await onFinish(prompt);}catch(e){setError((e as Error).message);finishing.current=false;setPending('');}
  };
  const go=(next:number)=>{
    if(leaving||pending)return;setDirection(next>step?1:-1);setLeaving(true);
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    timer.current=setTimeout(()=>{setStep(next);setLeaving(false);},reduced?0:210);
  };
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  useEffect(()=>{headline.current?.focus({preventScroll:true});},[step]);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const trap=(event:KeyboardEvent)=>{
      if(event.key!=='Tab')return;
      const nodes=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),summary')||[]).filter(x=>x.getClientRects().length>0);
      const first=nodes[0],last=nodes.at(-1);if(!first||!last)return;
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===headline.current)){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',trap);return()=>{document.removeEventListener('keydown',trap);previous?.focus();};
  },[]);
  useEffect(()=>{if(step===1&&!probed.current){probed.current=true;void run('probe',()=>onProbe());}},[step]);
  const checking=pending==='probe';
  return <div className="ftue-backdrop">
    <section className="ftue" role="dialog" aria-modal="true" aria-labelledby="ftue-title" ref={dialog}>
      <header className="ftue-topbar"><span className="ftue-brand"><img src="./helmet.png" width="40" height="40" alt=""/>Archi Helper<span className="ftue-edition">{t('ui.ftueFirstRun')}</span></span><button className="ftue-skip" onClick={()=>finish()} disabled={pending==='finish'}>{t('ui.ftueSkip')}<X size={15}/></button></header>
      <div className="ftue-main">
        <div className={`ftue-stage scene-${step} ${leaving?'is-leaving':''}`} data-direction={direction} aria-hidden="true">
          <div className="ftue-grid"/>
          <div className="ftue-stage-caption"><span className="ftue-live-dot"/>{['ARCHI / HELLO','ARCHI / CONNECT','ARCHI / WORKFLOW','ARCHI / LET’S BUILD'][step]}</div>
          <div className="ftue-plan"><svg viewBox="0 0 440 360" fill="none"><g className="ftue-plan-lines" stroke="currentColor" strokeWidth="1.5"><path d="M72 258V126l132-67 139 69v133l-137 69-134-72Z"/><path d="m72 126 134 69 137-67M206 195v135M72 194l134 68 137-67M139 92v134m135-132v134M139 160l135-66M139 226l135-67"/><path d="M35 137v132m-7-130h14m-14 128h14M94 292l92 47m-94-55v15m94 34v14" strokeDasharray="3 5"/></g><g className="ftue-plan-windows" stroke="currentColor" strokeWidth="2"><path d="m92 158 28 14v28l-28-14v-28Zm68 35 27 14v27l-27-14v-27Zm67 14 29-14v27l-29 14v-27Zm65-33 28-14v27l-28 14v-27Z"/></g></svg></div>
          {step===1&&<div className={`ftue-link ${ready?'is-connected':''}`}><span><img src="./helmet.png" alt=""/>{t('ui.ftueYourAssistant')}</span><div className={`ftue-signal ${checking?'is-checking':''}`}><i/><i/><i/><Plug size={21}/></div><span><Layers size={25}/>Archicad</span></div>}
          {step===2&&<div className="ftue-demo"><div className="ftue-demo-user">{t('ui.ftueDemoAsk')}</div><div className="ftue-demo-tool"><ShieldCheck size={15}/>{t('ui.ftueDemoRead')}</div><div className="ftue-demo-answer"><Check size={14}/>{t('ui.ftueDemoAnswer')}</div></div>}
          {step===3&&<div className="ftue-result-stamp"><Check size={20}/>{ready?t('ui.ftueAllSet'):t('ui.ftueYourPace')}</div>}
          <div className="ftue-engineer"><div className="ftue-engineer-shadow"/><Mascot size={step===0?208:176} animation={animations[step]}/></div>
          <div className="ftue-stage-foot"><span>01 — 04</span><span>{t('ui.ftueStageFoot')}</span><span>↗</span></div>
        </div>
        <div className="ftue-content">
          <nav className="ftue-steps" aria-label={t('ui.ftueProgress')}>{stepKeys.map((key,index)=><span key={key} className={index===step?'active':index<step?'done':''} aria-current={index===step?'step':undefined}><i>{index<step?<Check size={11}/>:String(index+1).padStart(2,'0')}</i><span>{t(key)}</span></span>)}</nav>
          <div key={step} className={`ftue-scene ${leaving?'is-leaving':''}`} data-direction={direction}>
            <p className="ftue-eyebrow">{t((['ui.ftueEyebrowWelcome','ui.ftueEyebrowConnect','ui.ftueEyebrowLearn','ui.ftueEyebrowStart'] as const)[step])}</p>
            <h1 id="ftue-title" ref={headline} tabIndex={-1}>{t((['ui.ftueTitleWelcome','ui.ftueTitleConnect','ui.ftueTitleLearn','ui.ftueTitleStart'] as const)[step])}</h1>
            <p className="ftue-description">{t((['ui.ftueDescWelcome','ui.ftueDescConnect','ui.ftueDescLearn','ui.ftueDescStart'] as const)[step])}</p>
            {step===0&&<div className="ftue-intro-list">
              <div><span><Plug size={19}/></span><p><strong>{t('ui.ftueIntroConnect')}</strong><small>{t('ui.ftueIntroConnectHint')}</small></p></div>
              <div><span><ShieldCheck size={19}/></span><p><strong>{t('ui.ftueIntroControl')}</strong><small>{t('ui.ftueIntroControlHint')}</small></p></div>
              <div><span><Folder size={19}/></span><p><strong>{t('ui.ftueIntroNoFolder')}</strong><small>{t('ui.ftueIntroNoFolderHint')}</small></p></div>
              <p className="ftue-provider"><Check size={13}/>{t('ui.ftueProviderReady',{name:providerName})}</p>
            </div>}
            {step===1&&<div className="ftue-connect-content">
              <div className="ftue-checklist" aria-live="polite" aria-busy={checking}>
                <CheckRow status={runtimeReady?'done':'wait'} title={t('ui.ftueRuntime')} description={t(runtimeReady?'ui.ftueRuntimeReady':'ui.ftueRuntimeMissing')}/>
                <CheckRow status={checking?'checking':connection.connected?'done':'wait'} title="Archicad" description={connection.connected?t('ui.ftueArchicadReady',{version:connection.data?.archicad_version||'',port:connection.port||chosenPort||t('ui.automatic')}):t('ui.ftueArchicadMissing')}/>
                <CheckRow status={checking?'checking':tapir?'done':'wait'} title="Tapir" description={tapir?t('ui.ftueTapirReady',{version:typeof connection.data?.tapir_installed==='string'?connection.data.tapir_installed:'',count:toolCount}):t(connection.connected?'ui.ftueTapirMissing':'ui.ftueTapirUnknown')}/>
              </div>
              <div className="ftue-connection-actions"><button className="secondary" disabled={!!pending||installing} onClick={()=>run('probe',()=>onProbe(chosenPort))}><RotateCw size={14} className={checking?'spin':''}/>{t(checking?'ui.ftueChecking':'ui.ftueRecheck')}</button>{!connection.connected&&<button className="text-button" disabled={!!pending} onClick={()=>run('open',onOpen)}>{t('ui.openPln')}<ChevronRight size={14}/></button>}{connection.connected&&!tapir&&<button className="text-button" disabled={!!pending||installing} onClick={()=>run('install',onInstall)}><Download size={14}/>{t('ui.installTapir')}</button>}</div>
              {!connection.connected&&!checking&&<p className="ftue-help">{t('ui.ftueOpenHint')}</p>}
              {!tapir&&<details className="ftue-details"><summary>{t('ui.ftueTapirHelp')}<ChevronDown size={13}/></summary><p>{t('ui.ftueTapirInstallHint')}</p><button className="text-button" disabled={!!pending||installing} onClick={()=>run('install',onInstall)}><Download size={13}/>{t('ui.installTapir')}</button></details>}
              {tapirProgress&&<p className={`ftue-install-progress ${tapirProgress.status==='error'?'has-error':''}`} role="status">{installing&&<LoaderCircle size={13} className="spin"/>}{t(tapirProgress.status==='launched'?'ui.ftueInstallerOpened':tapirProgress.status==='error'?'ui.tapirDownloadFailed':'ui.downloadingTapir')}{tapirProgress.status==='downloading'?` · ${tapirProgress.percent}%`:''}{tapirProgress.status==='error'&&` · ${tapirProgress.message}`}</p>}
              <details className="ftue-details"><summary>{t('ui.ftueInstances')}<ChevronDown size={13}/></summary><div className="ftue-port"><select aria-label={t('ui.port')} value={chosenPort} onChange={e=>setChosenPort(e.target.value)}><option value="">{t('ui.automatic')}</option>{Array.from({length:21},(_,i)=>String(19723+i)).map(p=><option key={p} value={p}>{p}{instances.some(x=>String(x.port)===p)?` · ${t('ui.ftueFound')}`:''}</option>)}</select><button className="text-button" disabled={!!pending} onClick={()=>run('scan',async()=>setInstances(await onScan()))}>{t('ui.findRunningInstances')}</button></div></details>
              {ready&&<p className="ftue-ready-note"><Check size={14}/>{t('ui.ftueConnectionReady')}</p>}
            </div>}
            {step===2&&<div className="ftue-lessons">
              <div><span>01</span><p><strong>{t('ui.ftueLessonAsk')}</strong><small>{t('ui.ftueLessonAskHint')}</small></p></div>
              <div><span>02</span><p><strong>{t('ui.ftueLessonReview')}</strong><small>{t('ui.ftueLessonReviewHint')}</small></p></div>
              <div><span>03</span><p><strong>{t('ui.ftueLessonFiles')}</strong><small>{t('ui.ftueLessonFilesHint')}</small></p></div>
            </div>}
            {step===3&&<div className="ftue-starters" role="radiogroup" aria-label={t('ui.ftueChoosePrompt')}>
              {(['ui.ftueStarterOverview','ui.ftueStarterSelection','ui.ftueStarterHelp'] as const).map((key,index)=><button key={key} role="radio" aria-checked={selected===index} className={selected===index?'selected':''} onClick={()=>setSelected(index)} onKeyDown={event=>{if(['ArrowDown','ArrowRight','ArrowUp','ArrowLeft'].includes(event.key)){event.preventDefault();const next=(selected+(['ArrowDown','ArrowRight'].includes(event.key)?1:2))%3;setSelected(next);(event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();}}}><span>{index===0?<Layers size={18}/>:index===1?<FileText size={18}/>:<Sparkles size={18}/>}</span><strong>{t(key)}</strong><i>{selected===index?<Check size={13}/>:<ChevronRight size={13}/>}</i></button>)}
              <p className="ftue-draft-hint">{t('ui.ftueDraftHint')}</p>
              {!ready&&<p className="ftue-offline-note">{t('ui.ftueConnectLater')}</p>}
            </div>}
          </div>
          {error&&<p className="ftue-error" role="alert">{error}</p>}
          <footer className="ftue-navigation"><div>{step>0&&<button className="ftue-back" disabled={!!pending||leaving} onClick={()=>go(step-1)}><ArrowLeft size={15}/>{t('ui.ftueBack')}</button>}</div><div>{step===1&&!ready&&<button className="ftue-later" disabled={!!pending||leaving} onClick={()=>go(2)}>{t('ui.ftueSetUpLater')}</button>}{step===3&&<button className="ftue-later" disabled={!!pending} onClick={()=>finish()}>{t('ui.ftueEmptyChat')}</button>}<button className="ftue-primary" disabled={!!pending||leaving||step===1&&!ready} onClick={()=>step===3?finish(prompts[selected]):go(step+1)}>{pending==='finish'?<LoaderCircle size={16} className="spin"/>:<>{t(step===0?'ui.ftueBegin':step===3?'ui.ftueStartChat':'ui.ftueNext')}<ArrowRight size={16}/></>}</button></div></footer>
        </div>
      </div>
    </section>
  </div>;
}

function CheckRow({status,title,description}:{status:'done'|'checking'|'wait';title:string;description:string}){
  return <div className={`ftue-check ${status}`}><span>{status==='done'?<Check size={16}/>:status==='checking'?<LoaderCircle size={16} className="spin"/>:<span className="ftue-wait-dot"/>}</span><div><strong>{title}</strong><small>{description}</small></div><i>{t(status==='done'?'ui.ftueStatusDone':status==='checking'?'ui.ftueStatusChecking':'ui.ftueStatusWait')}</i></div>;
}

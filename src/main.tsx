import { t, setLanguage, useLanguage } from './i18n';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, Folder, FolderOpen, ArrowUp, ArrowUpRight, Settings, X, Minus, Square, PanelRightClose, PanelRightOpen, Paperclip, ChevronDown, Check, Circle, RotateCw, Search, Box, Layers, Ruler, FileText, Download, Sparkles, ShieldCheck, ShieldAlert, Wrench, ChevronRight, MessageSquare, Cable, Cpu, ExternalLink, Play, StopCircle, Pencil, Trash2, Languages, Brain, Eye, Info, LockKeyhole, Copy, CircleAlert } from 'lucide-react';
import './style.css';
import { suggestions } from './suggestions';
import { Mascot } from './Mascot';
import { MessageContent } from './MessageContent';
import { needsModelRefresh, reasoningProfile, selectedEffort } from '../electron/reasoning.mjs';

declare global { interface Window { archi: {call:(method:string,input?:unknown)=>Promise<any>;onEvent:(cb:(e:any)=>void)=>()=>void} } }
type Project={id:string;name:string;path:string};
type Model={id:string;name:string;reasoningEfforts?:string[];contextWindow?:number};
type Provider={id:string;name:string;baseURL:string;hasKey:boolean;catalogVersion?:number;catalogUpdatedAt?:number;models:Model[];supportsImages?:boolean;reasoningFormat?:string;reasoningEfforts?:string[]};
type Message={id:string;role:string;text:string;name?:string;status?:string;summary?:string;args?:unknown;artifact?:{path:string;bytes:number};model?:string};
type Session={id:string;title:string;messages:Message[];updatedAt:number};
type Tool={key:string;name:string;description:string;readOnly:boolean;inputSchema:any};
type State={appVersion?:string;updateApplied?:boolean;updateOnly?:boolean;runtimeInfo?:{pythonVersion?:string};language:string;projects:Project[];providers:Provider[];providerId:string;model:string;reasoningEffort?:string;permissionMode?:string;archicadPort:string;connection:any;toolCount:number;runtimeReady:boolean;busy:boolean;activeSession?:string;update?:any};
const providerToForm=(p:Provider)=>({id:p.id,name:p.name,baseURL:p.baseURL,apiKey:'',supportsImages:p.supportsImages===true,reasoningFormat:p.reasoningFormat||'auto',reasoningEfforts:p.reasoningEfforts?.join(', ')||''});
const emptyProvider=()=>({id:'',name:'',baseURL:'',apiKey:'',supportsImages:false,reasoningFormat:'auto',reasoningEfforts:''});
const effortLabel=(value:string)=>t(({none:'ui.reasoningNone',minimal:'ui.reasoningMinimal',low:'ui.reasoningLow',medium:'ui.reasoningMedium',high:'ui.reasoningHigh',xhigh:'ui.reasoningXhigh',max:'ui.reasoningMax',ultra:'ui.reasoningUltra'} as const)[value as 'xhigh']);
const api=(method:string,input?:unknown)=>window.archi.call(method,input);
const pretty=(v:unknown)=>typeof v==='string'?v:JSON.stringify(v,null,2);
const bytes=(n:number)=>n>1048576?t('ui.mb',{value0:(n/1048576).toFixed(1)}):n>1024?t('ui.kb',{value0:Math.round(n/1024)}):t('ui.b',{value0:n});
const labels=():Record<string,string>=>({get_knowledge:t('ui.knowledge'),get_api_catalog:t('ui.apiCatalog'),find_tools:t('ui.findTools'),call_archicad:t('ui.archicadCommand'),list_files:t('ui.projectFiles'),read_file:t('ui.readResult'),view_image:t('ui.viewImage'),write_file:t('ui.saveFile'),run_python:t('ui.processData')});
function IconButton({title,onClick,children,disabled=false}:{title:string;onClick:()=>void;children:React.ReactNode;disabled?:boolean}) {
  return <button className="icon-button" title={title} aria-label={title} onClick={onClick} disabled={disabled}>{children}</button>;
}
function App(){
  const language=useLanguage();
  useEffect(()=>{document.documentElement.lang=language;document.title=`Archi Helper — ${t('ui.architectSAssistant')}`;},[language]);
  const [state,setState]=useState<State|null>(null),[project,setProject]=useState<Project|null>(null),[sessions,setSessions]=useState<Session[]>([]),[session,setSession]=useState<Session|null>(null);
  const [draft,setDraft]=useState(''),[mode,setMode]=useState('review'),[busy,setBusy]=useState(false),[stream,setStream]=useState<Record<string,string>>({}),[approval,setApproval]=useState<any>(null);
  const [update,setUpdate]=useState<any>(null),[choosing,setChoosing]=useState(false);
  const updateBlocking=!state||state.updateOnly===true||(!update?.deferred&&['checking','downloading','ready','countdown','installing','error'].includes(update?.status));
  const [modal,setModal]=useState(''),[notice,setNotice]=useState<{text:string;tone:'success'|'error'}|null>(null),[working,setWorking]=useState(''),[attachments,setAttachments]=useState<string[]>([]);
  const [projectName,setProjectName]=useState(''),[search,setSearch]=useState(''),[toolSearch,setToolSearch]=useState(''),[tools,setTools]=useState<Tool[]>([]),[selectedTool,setSelectedTool]=useState<Tool|null>(null),[toolArgs,setToolArgs]=useState('{}');
  const [providerForm,setProviderForm]=useState(emptyProvider),[manualModel,setManualModel]=useState(''),[port,setPort]=useState(''),[instances,setInstances]=useState<any[]>([]),[acVersion,setAcVersion]=useState('27');
  const providerEditor=useRef<HTMLDivElement>(null);
  const sessionRef=useRef<string|undefined>(undefined),projectRef=useRef<Project|null>(null),bottom=useRef<HTMLDivElement>(null),textInput=useRef<HTMLTextAreaElement>(null);
  sessionRef.current=session?.id;projectRef.current=project;
  const notify=useCallback((text:string,tone:'success'|'error'='success')=>setNotice({text,tone}),[]);
  const guard=useCallback(async(fn:()=>Promise<any>,label='')=>{try{if(label)setWorking(label);return await fn();}catch(e){notify((e as Error).message,'error');}finally{if(label)setWorking('');}},[notify]);
  const copyMessage=async(text:string)=>{
    try{await navigator.clipboard.writeText(text);notify(t('ui.messageCopied'));}
    catch{notify(t('ui.couldNotCopyMessage'),'error');}
  };
  useEffect(()=>{
    if(notice?.tone!=='success'||updateBlocking)return;
    const timer=setTimeout(()=>setNotice(null),4000);
    return()=>clearTimeout(timer);
  },[notice,updateBlocking]);
  const refresh=async()=>{const s=await api('bootstrap');setLanguage(s.language);setState(s);setUpdate(s.update);setPort(s.archicadPort);setMode(s.permissionMode||'review');return s;};
  const refreshSessions=async(p=projectRef.current)=>{if(p)setSessions(await api('sessions',{projectId:p.id}));};
  const openProject=async(p:Project)=>{
    if(busy)return;setProject(p);setStream({});setDraft('');setAttachments([]);
    const list=await api('sessions',{projectId:p.id});setSessions(list);
    const s=list.length?await api('session',{projectId:p.id,id:list[0].id}):await api('newSession',{projectId:p.id});
    setSession(s);if(!list.length)setSessions([s]);
  };
  useEffect(()=>{
    guard(async()=>{
      const s=await refresh();if(s.updateApplied)notify(t('ui.updateApplied',{version:s.appVersion}));if(s.projects.length)await openProject(s.projects[0]);
      const provider=s.providers.find((p:Provider)=>p.id===s.providerId);
      if(provider && needsModelRefresh(provider))await syncModels(provider.id);
    });
    return window.archi.onEvent(e=>{
      if(e.type==='update')setUpdate(e.update);
      if(e.type==='connection')setState(s=>s?{...s,connection:e.connection,toolCount:e.toolCount,runtimeReady:e.runtimeReady}:s);
      if(e.type==='busy'){setBusy(e.busy);if(!e.busy)guard(()=>refreshSessions());}
      if(e.sessionId!==sessionRef.current)return;
      if(e.type==='message'){
        setSession(s=>s?{...s,messages:[...s.messages.filter(m=>m.id!==e.message.id),e.message]}:s);
        setStream(v=>{const n={...v};delete n[e.message.id];return n;});
      }
      if(e.type==='delta')setStream(v=>({...v,[e.id]:(v[e.id]||'')+e.delta}));
      if(e.type==='approval'){setApproval(e.approval);setModal('');}
      if(e.type==='approval-done')setApproval(null);
    });
  },[]);
  useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth'});},[session?.messages,stream,approval]);
  const syncModels=async(id:string)=>{try{await api('models',{id});}finally{await refresh();}};
  const chooseSettings=(input:Record<string,string>)=>guard(async()=>{
    setChoosing(true);
    try{const s=await api('settings',input);setState(s);if(input.providerId){const p=s.providers.find((p:Provider)=>p.id===input.providerId);if(p&&needsModelRefresh(p))await syncModels(p.id);}}
    finally{setChoosing(false);}
  });
  const newSession=()=>guard(async()=>{if(!project)return;const s=await api('newSession',{projectId:project.id});setSession(s);setDraft('');setAttachments([]);setStream({});await refreshSessions();textInput.current?.focus();});
  const send=()=>guard(async()=>{
    if(!project || !session || !draft.trim() || busy || choosing || !state?.providerId || !state?.model)return;
    const text=draft.trim()+(attachments.length?t('ui.materialsInTheProjectFolder',{value0:attachments.map(x=>`- ${x}`).join('\n')}):'');
    setDraft('');setAttachments([]);setBusy(true);setStream({});
    try{await api('send',{projectId:project.id,sessionId:session.id,text,providerId:state?.providerId,model:state?.model,mode});}finally{setBusy(false);}
  });
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(updateBlocking)return;
      if(event.ctrlKey && event.key.toLowerCase()==='n'){event.preventDefault();if(project&&!busy)newSession();}
      if(event.key==='Escape')setModal('');
    };
    window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
  },[project,busy,updateBlocking]);
  useEffect(()=>{
    if(!modal)return;
    const previous=document.activeElement as HTMLElement|null;
    const dialog=document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable=()=>Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary')||[]).filter(x=>x.getClientRects().length>0);
    const frame=requestAnimationFrame(()=>focusable()[0]?.focus());
    const trap=(e:KeyboardEvent)=>{if(e.key!=='Tab')return;const items=focusable(),first=items[0],last=items[items.length-1];if(!first)return;if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}};
    document.addEventListener('keydown',trap);return()=>{cancelAnimationFrame(frame);document.removeEventListener('keydown',trap);previous?.focus();};
  },[modal]);
  useEffect(()=>{api('updateIdle',{idle:!busy&&!draft.trim()&&!attachments.length&&(!modal||updateBlocking)&&!approval}).catch(()=>{});},[busy,draft,attachments.length,modal,approval,updateBlocking]);
  const connect=()=>guard(async()=>{await api('connect');await refresh();},t('ui.connecting'));
  const openTools=()=>guard(async()=>{setTools(await api('tools'));setModal('tools');});
  const chooseTool=(t:Tool)=>{
    setSelectedTool(t);const args:Record<string,unknown>={};
    for(const k of t.inputSchema.required||[]) {const prop=t.inputSchema.properties?.[k];args[k]=prop?.enum?.[0]??(prop?.type==='array'?[]:prop?.type==='object'?{}:prop?.type==='number'||prop?.type==='integer'?0:prop?.type==='boolean'?false:'');}
    setToolArgs(JSON.stringify(args,null,2));
  };
  const reveal=(relative?:string)=>guard(()=>api('reveal',{projectId:project?.id,relative}));
  const openMessageLink=useCallback((href?:string)=>guard(()=>href?.startsWith('https:')?api('external',{url:href}):api('reveal',{projectId:project?.id,relative:href})),[guard,project?.id]);
  const selectedProvider=state?.providers.find(p=>p.id===state.providerId);
  const reasoning=reasoningProfile(selectedProvider,state?.model||'');
  const effort=selectedEffort(reasoning.efforts,state?.reasoningEffort||'xhigh');
  const isSettings=['providers','archicad','about'].includes(modal);
  const editProvider=(p?:Provider)=>{
    setProviderForm(p?providerToForm(p):emptyProvider());setManualModel('');
    requestAnimationFrame(()=>{providerEditor.current?.scrollIntoView({block:'nearest',behavior:'smooth'});providerEditor.current?.querySelector('input')?.focus({preventScroll:true});});
  };
  useEffect(()=>{
    document.querySelector('.settings-content')?.scrollTo(0,0);
    if(modal==='providers'&&!providerForm.id&&!providerForm.baseURL&&selectedProvider)setProviderForm(providerToForm(selectedProvider));
  },[modal]);
  const filteredTools=tools.filter(t=>`${t.name} ${t.description}`.toLowerCase().includes(toolSearch.toLowerCase()));
  const hasMessages=!!session?.messages.length||!!approval;
  const connected=state?.connection?.connected;
  const projectInfo=state?.connection.project;
  const projectLabel=projectInfo?.projectName||projectInfo?.name||projectInfo?.projectPath?.split(/[\\/]/).pop()||(projectInfo?.isUntitled?t('ui.untitledUnsaved'):t('ui.openProject'));
  const tapirVersion=connected?(typeof state?.connection.data?.tapir_installed==='string'?state.connection.data.tapir_installed:state?.connection.data?.tapir_installed===true?state.connection.data.tapir_definitions:''):'';
  const updateStatus=update?.status||'idle';
  const updateDescription=updateStatus==='disabled'?t('ui.updatesAreAvailableOnGithubReleases'):updateStatus==='error'?t('ui.updateRetryDescription'):updateStatus==='current'?t('ui.youHaveTheLatestVersion'):updateStatus==='checking'?t('ui.checkingUpdates'):updateStatus==='downloading'?t('ui.downloadingUpdate',{value0:update?.percent||0}):['ready','countdown'].includes(updateStatus)?t('ui.updateReadyWaitingForWorkToFinish'):updateStatus==='installing'?t('ui.installingUpdate'):t('ui.updatesInstallAutomatically');
  if(updateBlocking)return <UpdateNotice update={update||{status:'checking'}} updateOnly={state?.updateOnly===true} onLater={()=>guard(async()=>setUpdate(await api('deferUpdate')))} onRetry={()=>guard(async()=>setUpdate(await api('checkUpdates')))}/>;
  return <div className="app">
    <div className="titlebar"><div className="titlebar-brand"><img src="./helmet.png" alt="" width="32"/>Archi Helper</div><div className="titlebar-actions"><label className="language-switch" title={t('ui.language')}><Languages size={15}/><select aria-label={t('ui.language')} value={language} disabled={!state||busy||choosing} onChange={e=>{const language=e.target.value;guard(async()=>{setChoosing(true);try{const s=await api('settings',{language});setLanguage(s.language);setState(s);}finally{setChoosing(false);}});}}><option value="ru">RU</option><option value="en">EN</option></select></label><div className="window-controls"><IconButton title={t('ui.minimize')} onClick={()=>api('window',{action:'minimize'})}><Minus size={14}/></IconButton><IconButton title={t('ui.maximize')} onClick={()=>api('window',{action:'maximize'})}><Square size={11}/></IconButton><IconButton title={t('ui.close')} onClick={()=>api('window',{action:'close'})}><X size={15}/></IconButton></div></div></div>
    <div className="workspace">
      <aside className="sidebar">
        <button className="project-select" onClick={()=>setModal('projects')} disabled={busy}><Folder size={18}/><strong>{project?.name||t('ui.chooseProject')}</strong><ChevronDown size={14}/></button>
        <button className="new-chat" aria-label={t('ui.createANewSession')} title="Ctrl + N" onClick={newSession} disabled={!project||busy}><Plus size={17}/>{t('ui.newSession')}</button>
        {sessions.length>6&&<div className="sidebar-search"><Search size={14}/><input aria-label={t('ui.findSession')} placeholder={t('ui.search')} value={search} onChange={e=>setSearch(e.target.value)}/></div>}
        <div className="session-list">
          {sessions.filter(s=>s.title.toLowerCase().includes(search.toLowerCase())).map(s=><button className={`session-row ${session?.id===s.id?'selected':''}`} disabled={busy} key={s.id} onClick={()=>guard(async()=>{setSession(await api('session',{projectId:project?.id,id:s.id}));setStream({});setDraft('');setAttachments([]);})}><MessageSquare size={15}/><span>{s.title}</span></button>)}
        </div>
        <div className="sidebar-bottom"><button className="sidebar-link" disabled={!project} onClick={()=>reveal()}><FolderOpen size={17}/>{t('ui.projectFiles')}</button><button className="sidebar-link" onClick={()=>setModal('providers')}><Settings size={17}/>{t('ui.settings')}</button></div>
      </aside>
      <main className="main">
        <header className="chat-header"><strong className="session-title">{session?.title||t('ui.newProject')}</strong><div className="header-actions"><button className={`connection-pill ${connected?'online':''}`} onClick={()=>setModal('archicad')} title={connected?projectLabel:t('ui.connectionSettings')}><span/>{connected?`Archicad ${state?.connection.data?.archicad_version||''}`:t('ui.connectArchicad')}</button>{session&&<><IconButton title={t('ui.renameSession')} disabled={busy} onClick={()=>setModal('rename')}><Pencil size={15}/></IconButton><IconButton title={t('ui.exportConversation')} onClick={()=>guard(()=>api('exportSession',{projectId:project?.id,id:session.id}))}><Download size={16}/></IconButton></>}</div></header>
        <div className="conversation">
          {!hasMessages?<div className="welcome">
            <Mascot/>
            <h1>{project?t('ui.whatShallWeDo'):t('ui.startWithAProject')}</h1>
            {!project?<button className="primary welcome-create" onClick={()=>setModal('projects')}><Plus size={17}/>{t('ui.createProject')}</button>:<div className="suggestions">
              {suggestions().map(s=><button key={s.id} data-preset={s.id} title={s.description} onClick={()=>{setDraft(s.prompt);textInput.current?.focus();}}><Layers size={16}/><span>{s.title}</span></button>)}
            </div>}
          </div>:<div className="messages">
            {groupMessages(session?.messages||[]).map(group=>{const m=group.messages[0];return group.tools?<ToolGroup key={group.id} messages={group.messages} reveal={reveal}/>:<article key={m.id} className={`message ${m.role}`}><div className="message-author">{m.role==='assistant'?<><img src="./helmet.png" alt="" width="32"/><strong>Archi Helper</strong></>:m.role==='user'?<><span className="user-avatar">{t('ui.y')}</span><strong>{t('ui.you')}</strong></>:<><Circle size={13}/><strong>{t('ui.pleaseNote')}</strong></>}{(m.role==='user'||m.role==='assistant')&&<span className="message-actions"><IconButton title={t('ui.copyMessage')} disabled={!m.text} onClick={()=>copyMessage(m.text)}><Copy size={15}/></IconButton></span>}</div><div className="prose"><MessageContent text={m.text} projectId={project?.id} onLink={openMessageLink}/></div></article>;})}
            {Object.entries(stream).filter(([,text])=>text.length>0).map(([id,text])=><article key={id} className="message assistant"><div className="message-author"><img src="./helmet.png" alt="" width="32"/><strong>Archi Helper</strong><span className="thinking-dot"/><span className="message-actions"><IconButton title={t('ui.copyMessage')} onClick={()=>copyMessage(text)}><Copy size={15}/></IconButton></span></div><div className="prose"><MessageContent text={text} projectId={project?.id} onLink={openMessageLink}/></div></article>)}
            {busy&&!Object.keys(stream).length&&<div className="working-indicator"><Mascot size={32} working/>{t('ui.working')}</div>}
            {approval&&<div className="approval-card"><div className="approval-title"><ShieldCheck size={21}/><div><strong>{approval.kind==='python'?t('ui.runProcessing'):t('ui.confirmAction')}</strong><p>{approval.description}</p></div></div><details className="approval-details" open={approval.kind==='python'}><summary>{approval.kind==='python'?t('ui.codeToRun'):t('ui.viewExactParameters')}</summary><pre>{pretty(approval.args)}</pre></details>{approval.kind==='python'&&<p className="muted">{t('ui.theScriptRunsLocallyWithYourPermissions')}</p>}<div className="approval-actions"><button className="secondary" onClick={()=>guard(()=>api('approve',{id:approval.id,allowed:false}))}>{t('ui.cancel')}</button><button className="primary" onClick={()=>guard(()=>api('approve',{id:approval.id,allowed:true}))}><Check size={15}/>{t('ui.run')}</button></div></div>}
          </div>}
          <div ref={bottom}/>
        </div>
        <div className="composer-wrap">
          {attachments.length>0&&<div className="attachments">{attachments.map(a=><span key={a}><Paperclip size={12}/>{a.split('/').pop()}<button onClick={()=>setAttachments(v=>v.filter(x=>x!==a))}><X size={12}/></button></span>)}</div>}
          <div className={`composer ${busy?'is-busy':''}`}><textarea ref={textInput} aria-label={t('ui.taskForArchiHelper')} placeholder={project?t('ui.describeYourTask'):t('ui.chooseAProjectFirst')} value={draft} onChange={e=>setDraft(e.target.value)} disabled={!project||busy} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send();}}}/>

            <div className="composer-toolbar"><div className="composer-options"><IconButton title={t('ui.attachAPdfImageOrFile')} disabled={!project||busy} onClick={()=>guard(async()=>{const files=await api('attach',{projectId:project?.id});setAttachments(v=>[...v,...files]);})}><Plus size={20}/></IconButton><span className={`permission-control ${mode==='full'?'full-access':''}`} title={`${t('ui.workMode')}: ${mode==='full'?t('ui.fullAccess'):mode==='read'?t('ui.readOnly'):t('ui.askForApproval')}${mode==='full'?' · '+t('ui.commandsFilesAndPythonWithoutConfirmation'):''}`}>{mode==='full'?<ShieldAlert size={16}/>:mode==='read'?<Eye size={16}/>:<ShieldCheck size={16}/>}<select aria-label={t('ui.workMode')} value={mode} disabled={busy} onChange={e=>{const next=e.target.value;guard(async()=>{const s=await api('settings',{permissionMode:next});setState(s);setMode(next);});}}><option value="review">{t('ui.askForApproval')}</option><option value="full">{t('ui.fullAccess')}</option><option value="read">{t('ui.readOnly')}</option></select></span></div><div className="composer-ai"><select className="provider-select" title={selectedProvider?.name||t('ui.provider')} aria-label={t('ui.provider')} value={state?.providerId||''} disabled={busy||choosing||!state?.providers.length} onChange={e=>chooseSettings({providerId:e.target.value})}><option value="" disabled>{t('ui.connectAi')}</option>{state?.providers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><select className="model-select" title={selectedProvider?.models.find(m=>m.id===state?.model)?.name||state?.model||t('ui.chooseAModel')} aria-label={t('ui.model')} value={state?.model||''} disabled={busy||choosing||!selectedProvider} onChange={e=>chooseSettings({model:e.target.value})}><option value="">{t('ui.chooseAModel')}</option>{selectedProvider?.models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}{state?.model&&!selectedProvider?.models.some(m=>m.id===state.model)&&<option value={state.model}>{state.model}</option>}</select><IconButton title={t('ui.providerSettings')} onClick={()=>setModal('providers')}><Settings size={15}/></IconButton></div><div className="composer-reasoning" title={`${t('ui.reasoningLevel')}: ${effort?effortLabel(effort):t('ui.reasoningDefault')} · ${reasoning.toolRestricted?t('ui.reasoningToolsRestricted'):reasoning.efforts.length?t('ui.reasoningHint'):t('ui.reasoningUnavailable')}`}><Brain size={15}/><span className="effort-value" aria-hidden="true">{effort?effort.charAt(0).toUpperCase()+effort.slice(1):'—'}</span><select aria-label={t('ui.reasoningLevel')} value={effort} disabled={busy||choosing||!reasoning.efforts.length} onChange={e=>chooseSettings({reasoningEffort:e.target.value})}>{reasoning.efforts.length?reasoning.efforts.map(value=><option key={value} value={value}>{effortLabel(value)}</option>):<option value="">{t('ui.reasoningDefault')}</option>}</select></div>
            {busy?<button className="send-button stop" title={t('ui.stop')} onClick={()=>guard(()=>api('stop'))}><Square size={14} fill="currentColor"/></button>:<button className="send-button" title={t('ui.sendTask')} onClick={send} disabled={!draft.trim()||!project||!state?.model||choosing}><ArrowUp size={20}/></button>}</div>
          </div>
        </div>
      </main>
    </div>
    {notice&&<div className={`toast ${notice.tone}`} role={notice.tone==='error'?'alert':'status'} aria-atomic="true">{notice.tone==='error'?<CircleAlert size={17}/>:<Check size={17}/>}<span>{notice.text}</span><IconButton title={t('ui.dismissMessage')} onClick={()=>setNotice(null)}><X size={15}/></IconButton></div>}
    {modal&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal('');}}><section className={`modal ${modal==='tools'?'wide':isSettings?'settings-modal':''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="modal-header"><div><h2 id="dialog-title">{modal==='projects'?t('ui.yourProjects'):modal==='tools'?t('ui.archicadTools'):modal==='rename'?t('ui.sessionTitle'):t('ui.settings')}</h2></div><IconButton title={t('ui.closeDialog')} onClick={()=>setModal('')}><X size={19}/></IconButton></div>
      {modal==='projects'&&<div className="modal-body"><div className="project-list">{state?.projects.map(p=><button key={p.id} onClick={()=>guard(async()=>{await openProject(p);setModal('');})}><Folder size={21}/><span><strong>{p.name}</strong><small>{p.path}</small></span><ChevronRight size={16}/></button>)}</div><label>{t('ui.newProject')}<input value={projectName} onChange={e=>setProjectName(e.target.value)} placeholder={t('ui.projectName')}/></label><div className="form-actions"><button className="secondary" onClick={()=>guard(async()=>{const p=await api('createProject',{existing:true});if(p){await refresh();await openProject(p);setModal('');}},t('ui.choosingFolder'))}><FolderOpen size={16}/>{t('ui.openFolder')}</button><button className="primary" disabled={!!working} onClick={()=>guard(async()=>{const p=await api('createProject',{name:projectName.trim()||t('ui.newProject')});if(p){await refresh();await openProject(p);setModal('');}},t('ui.creatingProject'))}><Plus size={16}/>{t('ui.createProject')}</button></div></div>}
      {isSettings&&<div className="settings-layout">
        <nav className="settings-nav" aria-label={t('ui.settingsSections')}>
          <button aria-current={modal==='providers'?'page':undefined} onClick={()=>setModal('providers')}><Sparkles size={18}/>{t('ui.aiProviders')}</button>
          <button aria-current={modal==='archicad'?'page':undefined} onClick={()=>setModal('archicad')}><Cable size={18}/>Archicad</button>
          <button aria-current={modal==='about'?'page':undefined} onClick={()=>setModal('about')}><Info size={18}/>{t('ui.about')}</button>
        </nav>
        <div className="settings-content">
          {modal==='providers'&&<section className="settings-page" aria-labelledby="providers-heading">
            <div className="settings-page-header"><div><h3 id="providers-heading">{t('ui.aiProviders')}</h3><p>{t('ui.providerSectionDescription')}</p></div><button className="secondary" disabled={busy||!!working} onClick={()=>editProvider()}><Plus size={16}/>{t('ui.addProvider')}</button></div>
            {!!state?.providers.length&&<div className="settings-provider-list">{state.providers.map(p=><div className={`provider-row ${state.providerId===p.id?'active':''}`} key={p.id}>
              <button className="provider-select-row" disabled={busy||choosing||!!working} onClick={()=>chooseSettings({providerId:p.id})}><span className="provider-symbol">{p.name.slice(0,1).toUpperCase()}</span><span className="provider-meta"><span className="provider-name-line"><strong>{p.name}</strong>{state.providerId===p.id&&<span className="settings-badge">{t('ui.selectedInChat')}</span>}</span><small title={p.baseURL}>{p.baseURL} · {t('ui.modelCount',{count:p.models.length})}</small></span></button>
              <div className="provider-actions"><IconButton title={t('ui.editProvider')} disabled={busy||!!working} onClick={()=>editProvider(p)}><Pencil size={15}/></IconButton><IconButton title={t('ui.refreshModels')} disabled={busy||!!working||choosing} onClick={()=>guard(()=>syncModels(p.id),t('ui.fetchingModels'))}><RotateCw size={15}/></IconButton><IconButton title={t('ui.deleteProvider')} disabled={busy||!!working||choosing} onClick={()=>guard(async()=>{const next=await api('deleteProvider',{id:p.id});setState(next);if(providerForm.id===p.id)setProviderForm(next.providers.length?providerToForm(next.providers[0]):emptyProvider());})}><Trash2 size={15}/></IconButton></div>
            </div>)}</div>}
            <div className="settings-card settings-editor" ref={providerEditor}>
              <div className="settings-card-heading"><h4>{providerForm.id?t('ui.providerConnection',{name:providerForm.name}):t('ui.addProvider')}</h4><p>{providerForm.id?t('ui.editingConnection'):t('ui.newConnection')}</p></div>
              {!providerForm.id&&<div className="settings-presets">{[['lumv','https://lumv.app/v1'],['OpenAI','https://api.openai.com/v1'],['DeepSeek','https://api.deepseek.com'],['OpenRouter','https://openrouter.ai/api/v1'],[t('ui.localModel'),'http://localhost:1234/v1'],[t('ui.otherProvider'),'https://']].map(([name,baseURL])=><button key={baseURL} disabled={busy||!!working} onClick={()=>setProviderForm({...emptyProvider(),name,baseURL})}>{name}</button>)}</div>}
              <div className="settings-form">
                <div className="settings-fields"><label className="settings-field"><span>{t('ui.name')}</span><input value={providerForm.name} onChange={e=>setProviderForm(v=>({...v,name:e.target.value}))}/></label><label className="settings-field"><span>{t('ui.apiAddress')}</span><input value={providerForm.baseURL} onChange={e=>setProviderForm(v=>({...v,baseURL:e.target.value}))} placeholder="https://api.example.com/v1"/></label></div>
                <label className="settings-field"><span>{t('ui.apiKey')}</span><input type="password" autoComplete="off" value={providerForm.apiKey} onChange={e=>setProviderForm(v=>({...v,apiKey:e.target.value}))} placeholder={providerForm.id?t('ui.leaveBlankToKeepTheKey'):t('ui.pasteYourProviderKey')}/></label>
                <label className="settings-checkbox"><input type="checkbox" checked={providerForm.supportsImages} onChange={e=>setProviderForm(v=>({...v,supportsImages:e.target.checked}))}/>{t('ui.theApiAndModelSupportImages')}</label>
                <div className="settings-advanced-list">
                  <details className="settings-advanced"><summary>{t('ui.reasoningCompatibility')}<ChevronRight size={16}/></summary><div className="settings-advanced-content"><p>{t('ui.reasoningCompatibilityHint')}</p><label className="settings-field"><span>{t('ui.reasoningFormat')}</span><select value={providerForm.reasoningFormat} onChange={e=>setProviderForm(v=>({...v,reasoningFormat:e.target.value}))}><option value="auto">{t('ui.automatic')}</option><option value="effort">OpenAI / reasoning_effort</option><option value="openrouter">OpenRouter / reasoning.effort</option><option value="deepseek">DeepSeek / thinking</option><option value="none">{t('ui.reasoningUnsupported')}</option></select></label><label className="settings-field"><span>{t('ui.reasoningEfforts')}</span><input value={providerForm.reasoningEfforts} onChange={e=>setProviderForm(v=>({...v,reasoningEfforts:e.target.value}))} placeholder="low, medium, high, xhigh"/></label></div></details>
                  <details className="settings-advanced"><summary>{t('ui.modelById')}<ChevronRight size={16}/></summary><div className="settings-advanced-content"><div className="settings-control-row"><label className="settings-field"><span>{t('ui.modelId')}</span><input placeholder="model-id" value={manualModel} onChange={e=>setManualModel(e.target.value)}/></label><button className="secondary" disabled={!manualModel.trim()||!providerForm.id||busy||choosing||!!working} onClick={()=>guard(async()=>{await api('settings',{providerId:providerForm.id,model:manualModel.trim()});await refresh();setModal('');})}>{t('ui.select')}</button></div></div></details>
                </div>
                <div className="settings-actions"><button className="primary" disabled={!!working||busy||choosing} onClick={()=>guard(async()=>{const next=await api('saveProvider',{...providerForm,reasoningEfforts:providerForm.reasoningEfforts.split(',').map(v=>v.trim()).filter(Boolean)});setState(next);const saved=next.providers.find((p:Provider)=>p.id===providerForm.id)||next.providers.at(-1);setProviderForm(providerToForm(saved));await syncModels(saved.id);notify(t('ui.providerConnected'));},t('ui.checkingApi'))}>{working||t('ui.saveAndCheck')}</button></div>
              </div>
            </div>
          </section>}
          {modal==='archicad'&&<section className="settings-page" aria-labelledby="archicad-heading">
            <div className="settings-page-header"><div><h3 id="archicad-heading">Archicad</h3><p>{t('ui.archicadSectionDescription')}</p></div></div>
            <div className={`settings-card settings-connection ${connected?'online':''}`}>
              <div className="settings-connection-status"><span className="connection-dot"/><div><h4>{connected?t('ui.archicadConnected',{value0:state?.connection.data?.archicad_version||''}):t('ui.openAProjectInArchicad')}</h4><p className="connection-description">{connected?projectLabel:state?.connection.message}</p>{connected&&<p className="connection-meta">{tapirVersion&&`Tapir ${tapirVersion} · `}{t('ui.toolCount',{count:state?.toolCount||0})}</p>}</div></div>
              <div className="settings-connection-actions"><button className="primary" onClick={connect} disabled={busy||!!working}><RotateCw size={16} className={working===t('ui.connecting')?'spin':undefined}/>{working===t('ui.connecting')?t('ui.connectingAlt'):connected?t('ui.reconnect'):t('ui.connect')}</button><button className="secondary" disabled={!!working} onClick={()=>guard(()=>api('launchArchicad'))}><FolderOpen size={16}/>{t('ui.openPln')}</button></div>
            </div>
            <div className="settings-card">
              <div className="settings-card-title"><h4>{t('ui.tapirExtension')}</h4><span className={`settings-badge ${tapirVersion?'':'neutral'}`}>{tapirVersion?t('ui.installed'):connected?t('ui.notInstalled'):t('ui.statusUnknown')}</span></div>
              <p className="settings-description">{t('ui.tapirDescription')}</p>
              <div className="settings-control-row"><label className="settings-field"><span>{t('ui.archicadVersionForTapir')}</span><select value={acVersion} onChange={e=>setAcVersion(e.target.value)}>{[25,26,27,28,29,30].map(v=><option key={v} value={v}>Archicad {v}</option>)}</select></label><button className="secondary" disabled={!!working} onClick={()=>guard(async()=>{const result=await api('installTapir',{version:Number(acVersion)});notify(result.message);},t('ui.downloadingTapir'))}><Download size={16}/>{working===t('ui.downloadingTapir')?t('ui.downloading'):t('ui.installTapir')}</button></div>
            </div>
            <div className="settings-card settings-card-list">
              <details className="settings-advanced"><summary>{t('ui.chooseArchicadInstance')}<span>{state?.archicadPort||t('ui.automatic')}</span><ChevronRight size={16}/></summary><div className="settings-advanced-content"><div className="settings-control-row"><label className="settings-field"><span>{t('ui.port')}</span><select value={port} onChange={e=>setPort(e.target.value)}><option value="">{t('ui.automatic')}</option>{Array.from({length:21},(_,i)=>String(19723+i)).map(p=><option key={p} value={p}>{p}{instances.some(x=>String(x.port)===p)?t('ui.open'):''}</option>)}</select></label><button className="secondary" disabled={!!working||busy} onClick={()=>guard(async()=>{const found=await api('scan');setInstances(found);notify(found.length?t('ui.found',{value0:found.length}):t('ui.noRunningArchicadFound'));},t('ui.findingArchicad'))}>{t('ui.findRunningInstances')}</button><button className="primary" disabled={busy||!!working} onClick={()=>guard(async()=>{await api('settings',{archicadPort:port});await connect();})}>{t('ui.apply')}</button></div></div></details>
              <button className="settings-tools-link" onClick={openTools}><Wrench size={18}/><span>{t('ui.archicadTools')}</span><span className="settings-badge neutral">{state?.toolCount||0}</span><ChevronRight size={17}/></button>
            </div>
          </section>}
          {modal==='about'&&<section className="settings-page settings-about" aria-labelledby="about-heading">
            <div className="settings-page-header"><div><h3 id="about-heading">{t('ui.about')}</h3><p>{t('ui.aboutSectionDescription')}</p></div></div>
            <div className="settings-card settings-app-identity"><img src="./helmet.png" alt={t('ui.yellowHardHat')} width="48" height="48"/><div><h4>Archi Helper</h4><p>{t('ui.architectSAssistant')}</p></div><span className="settings-version">v{state?.appVersion||update?.version||'—'}</span></div>
            <div className={`settings-card settings-update ${updateStatus==='error'?'has-error':''}`}><span className="settings-update-icon"><RotateCw size={23} className={['checking','downloading'].includes(updateStatus)?'spin':undefined}/></span><div className="settings-update-copy"><h4>{t('ui.updates')}</h4><p role="status">{updateDescription}</p></div>{updateStatus==='disabled'?<button className="secondary" onClick={()=>guard(()=>api('external',{url:'https://github.com/streletskiy/archi-helper/releases'}))}><ExternalLink size={15}/>{t('ui.openReleases')}</button>:<button className="secondary" disabled={!!working||['checking','downloading','ready','countdown','installing'].includes(updateStatus)} onClick={()=>guard(async()=>setUpdate(await api('checkUpdates')))}>{t('ui.checkForUpdates')}</button>}</div>
            <section className="settings-info-section"><h4><LockKeyhole size={16}/>{t('ui.dataAndPrivacy')}</h4><dl className="settings-data"><div><dt>{t('ui.historyAndMaterials')}</dt><dd>{t('ui.inProjectFolder')}</dd></div><div><dt>{t('ui.apiKeys')}</dt><dd>{t('ui.windowsEncrypted')}</dd></div><div><dt>{t('ui.aiRequests')}</dt><dd>{t('ui.toSelectedProvider')}</dd></div></dl></section>
            <section className="settings-info-section"><h4>{t('ui.bundledComponents')}</h4><div className="settings-components">{[`Python${state?.runtimeInfo?.pythonVersion?' '+state.runtimeInfo.pythonVersion:''}`,'uv','MCP'].map(name=><span key={name}><Check size={14}/>{name}</span>)}</div></section>
            <footer className="settings-links"><button onClick={()=>guard(()=>api('external',{url:'https://github.com/streletskiy/archi-helper'}))}><ExternalLink size={14}/>{t('ui.projectOnGithub')}</button><button onClick={()=>guard(()=>api('external',{url:'https://github.com/ENZYME-APD/tapir-archicad-automation'}))}><ExternalLink size={14}/>Tapir Archicad Automation</button></footer>
          </section>}
        </div>
      </div>}
      {modal==='tools'&&<div className="tool-browser"><div className="tool-browser-list"><div className="sidebar-search"><Search size={15}/><input aria-label={t('ui.findTool')} placeholder={t('ui.nameOrDescription')} value={toolSearch} onChange={e=>setToolSearch(e.target.value)}/></div><small>{t('ui.toolCount',{count:filteredTools.length})}</small><div>{filteredTools.map(t=><button key={t.key} className={selectedTool?.key===t.key?'selected':''} onClick={()=>chooseTool(t)}><span>{t.readOnly?<Search size={13}/>:<Wrench size={13}/>}</span>{t.name}</button>)}</div></div><div className="tool-browser-detail">{selectedTool?<><div className="tool-name"><h3>{selectedTool.name}</h3><span className={`tag ${selectedTool.readOnly?'green':''}`}>{selectedTool.readOnly?t('ui.read'):t('ui.modify')}</span></div><p className="muted">{selectedTool.description}</p><details><summary>{t('ui.parameterSchema')}</summary><pre>{pretty(selectedTool.inputSchema)}</pre></details><label>{t('ui.jsonParameters')}<textarea className="code-input" value={toolArgs} onChange={e=>setToolArgs(e.target.value)} rows={9}/></label><button className="primary" disabled={!project||!session||busy} onClick={()=>guard(async()=>{const args=JSON.parse(toolArgs);setModal('');await api('directTool',{projectId:project?.id,sessionId:session?.id,key:selectedTool.key,args,mode});})}><Play size={15}/>{t('ui.run')}</button></>:<div className="tool-placeholder"><Wrench size={30}/><p>{t('ui.chooseAToolOnTheLeft')}</p></div>}</div></div>}
      {modal==='rename'&&<Rename title={session?.title||''} onSave={title=>guard(async()=>{await api('renameSession',{projectId:project?.id,id:session?.id,title});setSession(s=>s?{...s,title}:s);await refreshSessions();setModal('');})}/>}
    </section></div>}
  </div>;
}
function groupMessages(messages:Message[]){
  const groups:{id:string;tools:boolean;messages:Message[]}[]=[];
  for(const message of messages){const previous=groups.at(-1);if(message.role==='tool'&&previous?.tools)previous.messages.push(message);else groups.push({id:message.id,tools:message.role==='tool',messages:[message]});}
  return groups;
}
function ToolGroup({messages,reveal}:{messages:Message[];reveal:(relative?:string)=>unknown}){
  const active=messages.find(m=>m.status==='running'),running=!!active,errors=messages.filter(m=>m.status==='error').length;
  const title=(m:Message)=>{const args=m.args as {purpose?:string;name?:string;path?:string}|undefined;return [args?.purpose,args?.name,args?.path,labels()[m.name||''],m.name].find(value=>typeof value==='string'&&value.trim());};
  const milestones=messages.filter(m=>m.summary);
  return <div className="tool-activity">
    {milestones.length>0&&<ul className="tool-progress" aria-label={t('ui.taskProgress')} aria-live="polite" aria-relevant="additions text">{milestones.map(m=><li key={m.id} className={m.status==='error'?'has-error':''}>{m.status==='error'?<CircleAlert size={14}/>:<Check size={14}/>}<span>{m.summary}</span></li>)}</ul>}
    <details className={`tool-group ${running?'is-running':''} ${errors?'has-errors':''}`}><summary>{running?<RotateCw className="spin" size={14}/>:<Wrench size={14}/>}<strong>{active?title(active):t('ui.toolGroup',{count:messages.length})}</strong><span>{running?t('ui.running'):errors?t('ui.toolGroupErrors',{count:errors}):t('ui.toolGroupDone')}</span><ChevronDown size={14}/></summary><div className="tool-group-content">{messages.map(m=><details key={m.id} className={`tool-message ${m.status}`}><summary><span className="tool-state">{m.status==='running'?<RotateCw className="spin" size={14}/>:m.status==='error'?<X size={14}/>:<Check size={14}/>}</span><strong>{title(m)}</strong><span>{m.status==='running'?t('ui.running'):m.artifact?bytes(m.artifact.bytes):''}</span><ChevronDown size={13}/></summary><div className="tool-detail">{m.args!==undefined&&<><label>{t('ui.parameters')}</label><pre>{pretty(m.args)}</pre></>}<label>{t('ui.result')}</label><pre>{m.text}</pre>{m.artifact&&<button className="text-button" onClick={()=>reveal(m.artifact?.path)}><FileText size={14}/>{t('ui.fullResult')}{' '}{bytes(m.artifact.bytes)}<ArrowUpRight size={13}/></button>}</div></details>)}</div></details>
  </div>;
}
function Rename({title,onSave}:{title:string;onSave:(s:string)=>void}){const [value,setValue]=useState(title);return <div className="modal-body"><label>{t('ui.name')}<input autoFocus value={value} onChange={e=>setValue(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')onSave(value);}}/></label><div className="form-actions"><button className="primary" onClick={()=>onSave(value)}>{t('ui.save')}</button></div></div>;}
function UpdateNotice({update,updateOnly,onLater,onRetry}:{update:any;updateOnly:boolean;onLater:()=>void;onRetry:()=>void}){
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(update?.status!=='countdown')return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[update?.status,update?.restartAt]);
  const status=update.status,percent=Math.max(0,Math.min(100,Math.round(update.percent||0)));
  const spinning=['checking','downloading','installing'].includes(status),indeterminate=['checking','installing'].includes(status);
  const text=status==='checking'?t('ui.checkingUpdates'):status==='downloading'?t('ui.downloadingUpdate',{value0:percent}):status==='countdown'?t('ui.updateReadyRestartingInS',{value0:Math.max(0,Math.ceil((update.restartAt-now)/1000))}):status==='installing'?t(update.stage==='preparing'?'ui.updatePreparingTitle':update.stage==='restarting'?'ui.updateRestartingTitle':update.stage==='reopening'?'ui.reopenApplication':'ui.installingUpdate'):status==='error'?t('ui.updateFailed'):status==='current'?t('ui.youHaveTheLatestVersion'):update.deferred?t('ui.willUpdateOnNextLaunch'):t('ui.updateReadyWaitingForWorkToFinish');
  const description=status==='checking'?t('ui.updateCheckingDescription'):status==='downloading'?t('ui.updateDownloadDescription'):status==='installing'?t(update.stage==='preparing'?'ui.updatePreparingDescription':update.stage==='restarting'?'ui.updateRestartingDescription':update.stage==='reopening'?'ui.updateReopeningDescription':'ui.updateInstallDescription'):status==='error'?t(updateOnly?'ui.updateInstallFailedDescription':'ui.updateRetryDescription'):status==='countdown'?t('ui.updateRestartDescription'):status==='ready'?t(update.deferred?'ui.updateDeferredDescription':'ui.updateWaitingDescription'):'';
  const step=status==='checking'?0:status==='downloading'?1:update.stage==='restarting'?3:2;
  const steps=[t('ui.updateCheckStage'),t('ui.updateDownloadStage'),t('ui.updateInstallStage'),t('ui.updateLaunchStage')];
  return <div className="update-screen"><section className={`update-notice ${status==='error'?'has-error':''}`} aria-label={t('ui.updates')}>
    <div className="update-screen-brand"><img src="./helmet.png" alt="" width="36" height="36"/><span>Archi Helper</span></div>
    <div className="update-notice-heading"><span className="update-notice-icon" aria-hidden="true">{spinning?<RotateCw size={25} className="spin"/>:status==='error'?<CircleAlert size={25}/>:<Check size={25}/>}</span><div className="update-notice-copy" role="status"><strong>{text}</strong>{(update.nextVersion||update.version)&&<span>v{update.nextVersion||update.version}</span>}</div></div>
    {!['error','current'].includes(status)&&<><ol className="update-steps">{steps.map((label,index)=><li key={label} className={index<step?'done':index===step?'active':''} aria-current={index===step?'step':undefined}><span aria-hidden="true">{index<step?<Check size={12}/>:index===step&&spinning?<RotateCw size={12} className="spin"/>:<Circle size={12}/>}</span>{label}</li>)}</ol><div className={`update-progress ${indeterminate?'is-indeterminate':''}`} role="progressbar" aria-label={text} aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate?undefined:status==='downloading'?percent:100}><span style={{width:indeterminate?'30%':`${status==='downloading'?percent:100}%`}}/></div></>}
    {status==='downloading'&&<div className="update-transfer"><span>{update.total>0?t('ui.updateTransfer',{transferred:bytes(update.transferred||0),total:bytes(update.total)}):`${percent}%`}</span>{update.bytesPerSecond>0&&<span>{t('ui.updateSpeed',{speed:bytes(update.bytesPerSecond)})}</span>}</div>}
    {description&&<p className="update-notice-description">{description}</p>}
    {(['ready','countdown'].includes(status)&&!update.deferred||status==='error')&&<div className="update-notice-actions">{status==='error'&&!updateOnly&&<button className="text-button" onClick={onLater}>{t('ui.continueWithoutUpdate')}</button>}<button className="secondary" onClick={status==='error'?onRetry:onLater}>{status==='error'?t(updateOnly?'ui.reopenApplication':'ui.checkForUpdates'):t('ui.later')}</button></div>}
  </section></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);

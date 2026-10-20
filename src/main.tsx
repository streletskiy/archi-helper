import { t, setLanguage, useLanguage } from './i18n';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, Folder, FolderOpen, ArrowUp, ArrowUpRight, Settings, X, Minus, Square, PanelRightClose, PanelRightOpen, Paperclip, ChevronDown, Check, Circle, RotateCw, Search, Box, Layers, Ruler, FileText, Download, Sparkles, ShieldCheck, ShieldAlert, Wrench, ChevronRight, MessageSquare, Cable, Cpu, ExternalLink, Play, StopCircle, Pencil, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './style.css';
import { suggestions } from './suggestions';
import { Mascot } from './Mascot';

declare global { interface Window { archi: {call:(method:string,input?:unknown)=>Promise<any>;onEvent:(cb:(e:any)=>void)=>()=>void} } }
type Project={id:string;name:string;path:string};
type Model={id:string;name:string};
type Provider={id:string;name:string;baseURL:string;hasKey:boolean;models:Model[];supportsImages?:boolean};
type Message={id:string;role:string;text:string;name?:string;status?:string;args?:unknown;artifact?:{path:string;bytes:number};model?:string};
type Session={id:string;title:string;messages:Message[];updatedAt:number};
type Tool={key:string;name:string;description:string;readOnly:boolean;inputSchema:any};
type State={language:string;projects:Project[];providers:Provider[];providerId:string;model:string;permissionMode?:string;archicadPort:string;connection:any;toolCount:number;runtimeReady:boolean;busy:boolean;activeSession?:string;update?:any};
const api=(method:string,input?:unknown)=>window.archi.call(method,input);
const pretty=(v:unknown)=>typeof v==='string'?v:JSON.stringify(v,null,2);
const bytes=(n:number)=>n>1048576?t('ui.mb',{value0:(n/1048576).toFixed(1)}):n>1024?t('ui.kb',{value0:Math.round(n/1024)}):t('ui.b',{value0:n});
const labels=():Record<string,string>=>({find_tools:t('ui.findTools'),call_archicad:t('ui.archicadCommand'),list_files:t('ui.projectFiles'),read_file:t('ui.readResult'),view_image:t('ui.viewImage'),write_file:t('ui.saveFile'),run_python:t('ui.processData')});
function IconButton({title,onClick,children,disabled=false}:{title:string;onClick:()=>void;children:React.ReactNode;disabled?:boolean}) {
  return <button className="icon-button" title={title} aria-label={title} onClick={onClick} disabled={disabled}>{children}</button>;
}
function ProjectImage({projectId,src,alt}:{projectId?:string;src?:string;alt?:string}){
  const [url,setURL]=useState(''),[error,setError]=useState('');
  useEffect(()=>{let live=true;if(projectId&&src)api('image',{projectId,relative:src}).then(v=>{if(live)setURL(v);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[projectId,src]);
  return url?<img className="project-image" src={url} alt={alt||t('ui.processingResult')}/>:<span className="muted">{error||t('ui.loadingImage')}</span>;
}
function App(){
  const language=useLanguage();
  useEffect(()=>{document.documentElement.lang=language;document.title=`Archi Helper — ${t('ui.architectSAssistant')}`;},[language]);
  const [state,setState]=useState<State|null>(null),[project,setProject]=useState<Project|null>(null),[sessions,setSessions]=useState<Session[]>([]),[session,setSession]=useState<Session|null>(null);
  const [draft,setDraft]=useState(''),[mode,setMode]=useState('review'),[busy,setBusy]=useState(false),[stream,setStream]=useState<Record<string,string>>({}),[approval,setApproval]=useState<any>(null);
  const [update,setUpdate]=useState<any>(null);
  const [modal,setModal]=useState(''),[notice,setNotice]=useState(''),[working,setWorking]=useState(''),[attachments,setAttachments]=useState<string[]>([]);
  const [projectName,setProjectName]=useState(''),[search,setSearch]=useState(''),[toolSearch,setToolSearch]=useState(''),[tools,setTools]=useState<Tool[]>([]),[selectedTool,setSelectedTool]=useState<Tool|null>(null),[toolArgs,setToolArgs]=useState('{}');
  const [providerForm,setProviderForm]=useState({id:'',name:'',baseURL:'',apiKey:'',supportsImages:false}),[manualModel,setManualModel]=useState(''),[port,setPort]=useState(''),[instances,setInstances]=useState<any[]>([]),[acVersion,setAcVersion]=useState('27');
  const sessionRef=useRef<string|undefined>(undefined),projectRef=useRef<Project|null>(null),bottom=useRef<HTMLDivElement>(null),textInput=useRef<HTMLTextAreaElement>(null);
  sessionRef.current=session?.id;projectRef.current=project;
  const guard=async(fn:()=>Promise<any>,label='')=>{try{if(label)setWorking(label);return await fn();}catch(e){setNotice((e as Error).message);}finally{if(label)setWorking('');}};
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
      const s=await refresh();if(s.projects.length)await openProject(s.projects[0]);
      const provider=s.providers.find((p:Provider)=>p.id===s.providerId);
      if(provider && !provider.models.length)await syncModels(provider.id);
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
  const syncModels=async(id:string)=>{await api('models',{id});const s=await refresh();if(!s.model){const m=s.providers.find((p:Provider)=>p.id===id)?.models[0];if(m){await api('settings',{providerId:id,model:m.id});await refresh();}}};
  const newSession=()=>guard(async()=>{if(!project)return;const s=await api('newSession',{projectId:project.id});setSession(s);setDraft('');setAttachments([]);setStream({});await refreshSessions();textInput.current?.focus();});
  const send=()=>guard(async()=>{
    if(!project || !session || !draft.trim() || busy)return;
    const text=draft.trim()+(attachments.length?t('ui.materialsInTheProjectFolder',{value0:attachments.map(x=>`- ${x}`).join('\n')}):'');
    setDraft('');setAttachments([]);setBusy(true);setStream({});
    try{await api('send',{projectId:project.id,sessionId:session.id,text,providerId:state?.providerId,model:state?.model,mode});}finally{setBusy(false);}
  });
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(event.ctrlKey && event.key.toLowerCase()==='n'){event.preventDefault();if(project&&!busy)newSession();}
      if(event.key==='Escape')setModal('');
    };
    window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
  },[project,busy]);
  useEffect(()=>{
    if(!modal)return;
    const previous=document.activeElement as HTMLElement|null;
    const dialog=document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable=()=>Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary')||[]).filter(x=>x.getClientRects().length>0);
    const frame=requestAnimationFrame(()=>focusable()[0]?.focus());
    const trap=(e:KeyboardEvent)=>{if(e.key!=='Tab')return;const items=focusable(),first=items[0],last=items[items.length-1];if(!first)return;if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}};
    document.addEventListener('keydown',trap);return()=>{cancelAnimationFrame(frame);document.removeEventListener('keydown',trap);previous?.focus();};
  },[modal]);
  useEffect(()=>{api('updateIdle',{idle:!busy&&!draft.trim()&&!attachments.length&&!modal&&!approval}).catch(()=>{});},[busy,draft,attachments.length,modal,approval]);
  const connect=()=>guard(async()=>{await api('connect');await refresh();},t('ui.connecting'));
  const openTools=()=>guard(async()=>{setTools(await api('tools'));setModal('tools');});
  const chooseTool=(t:Tool)=>{
    setSelectedTool(t);const args:Record<string,unknown>={};
    for(const k of t.inputSchema.required||[]) {const prop=t.inputSchema.properties?.[k];args[k]=prop?.enum?.[0]??(prop?.type==='array'?[]:prop?.type==='object'?{}:prop?.type==='number'||prop?.type==='integer'?0:prop?.type==='boolean'?false:'');}
    setToolArgs(JSON.stringify(args,null,2));
  };
  const reveal=(relative?:string)=>guard(()=>api('reveal',{projectId:project?.id,relative}));
  const selectedProvider=state?.providers.find(p=>p.id===state.providerId);
  const filteredTools=tools.filter(t=>`${t.name} ${t.description}`.toLowerCase().includes(toolSearch.toLowerCase()));
  const hasMessages=!!session?.messages.length||!!approval;
  const connected=state?.connection?.connected;
  const projectInfo=state?.connection.project;
  const projectLabel=projectInfo?.projectName||projectInfo?.name||projectInfo?.projectPath?.split(/[\\/]/).pop()||(projectInfo?.isUntitled?t('ui.untitledUnsaved'):t('ui.openProject'));
  return <div className="app">
    <div className="titlebar"><div className="titlebar-brand"><img src="./helmet.png" alt="" width="32"/>Archi Helper</div><div className="window-controls"><IconButton title={t('ui.minimize')} onClick={()=>api('window',{action:'minimize'})}><Minus size={14}/></IconButton><IconButton title={t('ui.maximize')} onClick={()=>api('window',{action:'maximize'})}><Square size={11}/></IconButton><IconButton title={t('ui.close')} onClick={()=>api('window',{action:'close'})}><X size={15}/></IconButton></div></div>
    <UpdateNotice update={update} onLater={()=>guard(()=>api('deferUpdate'))}/>
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
            {session?.messages.map(m=>m.role==='tool'?<details key={m.id} className={`tool-message ${m.status}`}><summary><span className="tool-state">{m.status==='running'?<RotateCw className="spin" size={14}/>:m.status==='error'?<X size={14}/>:<Check size={14}/>}</span><strong>{labels()[m.name||'']||m.name}</strong><span>{m.status==='running'?t('ui.running'):m.artifact?bytes(m.artifact.bytes):''}</span><ChevronDown size={13}/></summary><div className="tool-detail">{m.args!==undefined&&<><label>{t('ui.parameters')}</label><pre>{pretty(m.args)}</pre></>}<label>{t('ui.result')}</label><pre>{m.text}</pre>{m.artifact&&<button className="text-button" onClick={()=>reveal(m.artifact?.path)}><FileText size={14}/>{t('ui.fullResult')}{' '}{bytes(m.artifact.bytes)}<ArrowUpRight size={13}/></button>}</div></details>:<article key={m.id} className={`message ${m.role}`}><div className="message-author">{m.role==='assistant'?<><img src="./helmet.png" alt="" width="32"/><strong>Archi Helper</strong></>:m.role==='user'?<><span className="user-avatar">{t('ui.y')}</span><strong>{t('ui.you')}</strong></>:<><Circle size={13}/><strong>{t('ui.pleaseNote')}</strong></>}</div><div className="prose"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{img:({src,alt})=><ProjectImage projectId={project?.id} src={typeof src==='string'?src:undefined} alt={alt}/>,a:({href,children})=><button className="inline-link" onClick={()=>href?.startsWith('https:')?guard(()=>api('external',{url:href})):reveal(href)}>{children}</button>}}>{m.text}</ReactMarkdown></div></article>)}
            {Object.entries(stream).filter(([,text])=>text.length>0).map(([id,text])=><article key={id} className="message assistant"><div className="message-author"><img src="./helmet.png" alt="" width="32"/><strong>Archi Helper</strong><span className="thinking-dot"/></div><div className="prose"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div></article>)}
            {busy&&!Object.keys(stream).length&&<div className="working-indicator"><Mascot size={32} working/>{t('ui.working')}</div>}
            {approval&&<div className="approval-card"><div className="approval-title"><ShieldCheck size={21}/><div><strong>{approval.kind==='python'?t('ui.runProcessing'):t('ui.confirmAction')}</strong><p>{approval.description}</p></div></div><details className="approval-details" open={approval.kind==='python'}><summary>{approval.kind==='python'?t('ui.codeToRun'):t('ui.viewExactParameters')}</summary><pre>{pretty(approval.args)}</pre></details>{approval.kind==='python'&&<p className="muted">{t('ui.theScriptRunsLocallyWithYourPermissions')}</p>}<div className="approval-actions"><button className="secondary" onClick={()=>guard(()=>api('approve',{id:approval.id,allowed:false}))}>{t('ui.cancel')}</button><button className="primary" onClick={()=>guard(()=>api('approve',{id:approval.id,allowed:true}))}><Check size={15}/>{t('ui.run')}</button></div></div>}
          </div>}
          <div ref={bottom}/>
        </div>
        <div className="composer-wrap">
          {attachments.length>0&&<div className="attachments">{attachments.map(a=><span key={a}><Paperclip size={12}/>{a.split('/').pop()}<button onClick={()=>setAttachments(v=>v.filter(x=>x!==a))}><X size={12}/></button></span>)}</div>}
          <div className={`composer ${busy?'is-busy':''}`}><textarea ref={textInput} aria-label={t('ui.taskForArchiHelper')} placeholder={project?t('ui.describeYourTask'):t('ui.chooseAProjectFirst')} value={draft} onChange={e=>setDraft(e.target.value)} disabled={!project||busy} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send();}}}/>
            <div className="composer-toolbar"><div className="composer-options"><IconButton title={t('ui.attachAPdfImageOrFile')} disabled={!project||busy} onClick={()=>guard(async()=>{const files=await api('attach',{projectId:project?.id});setAttachments(v=>[...v,...files]);})}><Plus size={20}/></IconButton><span className={`permission-control ${mode==='full'?'full-access':''}`} title={mode==='full'?t('ui.commandsFilesAndPythonWithoutConfirmation'):undefined}>{mode==='full'?<ShieldAlert size={16}/>:<ShieldCheck size={16}/>}<select aria-label={t('ui.workMode')} value={mode} disabled={busy} onChange={e=>{const next=e.target.value;guard(async()=>{const s=await api('settings',{permissionMode:next});setState(s);setMode(next);});}}><option value="review">{t('ui.askForApproval')}</option><option value="full">{t('ui.fullAccess')}</option><option value="read">{t('ui.readOnly')}</option></select></span></div><div className="composer-model"><select aria-label={t('ui.model')} value={state?.model||''} disabled={busy} onChange={e=>guard(async()=>{await api('settings',{model:e.target.value});await refresh();})}><option value="">{t('ui.chooseAModel')}</option>{selectedProvider?.models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}{state?.model&&!selectedProvider?.models.some(m=>m.id===state.model)&&<option value={state.model}>{state.model}</option>}</select><button className="provider-mini" onClick={()=>setModal('providers')} title={t('ui.providerSettings')}>{selectedProvider?.name||t('ui.connectAi')}</button></div>
            {busy?<button className="send-button stop" title={t('ui.stop')} onClick={()=>guard(()=>api('stop'))}><Square size={14} fill="currentColor"/></button>:<button className="send-button" title={t('ui.sendTask')} onClick={send} disabled={!draft.trim()||!project||!state?.model}><ArrowUp size={20}/></button>}</div>
          </div>
        </div>
      </main>
    </div>
    {notice&&<div className="toast" role="alert"><span>{notice}</span><IconButton title={t('ui.dismissMessage')} onClick={()=>setNotice('')}><X size={15}/></IconButton></div>}
    {modal&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal('');}}><section className={`modal ${modal==='tools'?'wide':''}`} role="dialog" aria-modal="true"><div className="modal-header"><div><h2>{modal==='projects'?t('ui.yourProjects'):modal==='tools'?t('ui.archicadTools'):modal==='rename'?t('ui.sessionTitle'):t('ui.settings')}</h2></div><IconButton title={t('ui.closeDialog')} onClick={()=>setModal('')}><X size={19}/></IconButton></div>
      {['providers','archicad','about'].includes(modal)&&<nav className="settings-tabs"><button className={modal==='providers'?'active':''} onClick={()=>setModal('providers')}><Sparkles size={15}/>{t('ui.models')}</button><button className={modal==='archicad'?'active':''} onClick={()=>setModal('archicad')}><Cable size={15}/>Archicad</button><button className={modal==='about'?'active':''} onClick={()=>setModal('about')}>{t('ui.about')}</button></nav>}
      {modal==='projects'&&<div className="modal-body"><div className="project-list">{state?.projects.map(p=><button key={p.id} onClick={()=>guard(async()=>{await openProject(p);setModal('');})}><Folder size={21}/><span><strong>{p.name}</strong><small>{p.path}</small></span><ChevronRight size={16}/></button>)}</div><label>{t('ui.newProject')}<input value={projectName} onChange={e=>setProjectName(e.target.value)} placeholder={t('ui.projectName')}/></label><div className="form-actions"><button className="secondary" onClick={()=>guard(async()=>{const p=await api('createProject',{existing:true});if(p){await refresh();await openProject(p);setModal('');}},t('ui.choosingFolder'))}><FolderOpen size={16}/>{t('ui.openFolder')}</button><button className="primary" disabled={!!working} onClick={()=>guard(async()=>{const p=await api('createProject',{name:projectName.trim()||t('ui.newProject')});if(p){await refresh();await openProject(p);setModal('');}},t('ui.creatingProject'))}><Plus size={16}/>{t('ui.createProject')}</button></div></div>}
      {modal==='providers'&&<div className="modal-body"><div className="provider-list">{state?.providers.map(p=><div className={`provider-row ${state.providerId===p.id?'active':''}`} key={p.id}><button onClick={()=>guard(async()=>{await api('settings',{providerId:p.id,model:p.models[0]?.id||''});await refresh();})}><span className="provider-symbol">{p.name.slice(0,1).toUpperCase()}</span><span><strong>{p.name}</strong><small>{p.baseURL} · {t('ui.modelCount',{count:p.models.length})}</small></span>{state.providerId===p.id&&<Check size={17}/>}</button><IconButton title={t('ui.editProvider')} onClick={()=>setProviderForm({id:p.id,name:p.name,baseURL:p.baseURL,apiKey:'',supportsImages:p.supportsImages===true})}><Pencil size={15}/></IconButton><IconButton title={t('ui.refreshModels')} onClick={()=>guard(()=>syncModels(p.id),t('ui.fetchingModels'))}><RotateCw size={15}/></IconButton><IconButton title={t('ui.deleteProvider')} onClick={()=>guard(async()=>{await api('deleteProvider',{id:p.id});await refresh();})}><Trash2 size={15}/></IconButton></div>)}</div>
        <h3>{providerForm.id?t('ui.editProvider'):t('ui.addProvider')}</h3><div className="preset-row"><button onClick={()=>setProviderForm({id:'',name:t('ui.localModel'),baseURL:'http://localhost:1234/v1',apiKey:'',supportsImages:false})}>{t('ui.localModel')}</button><button onClick={()=>setProviderForm({id:'',name:'',baseURL:'https://',apiKey:'',supportsImages:false})}>{t('ui.otherProvider')}</button></div>
        <div className="form-grid"><label>{t('ui.name')}<input value={providerForm.name} onChange={e=>setProviderForm(v=>({...v,name:e.target.value}))}/></label><label>{t('ui.baseUrl')}<input value={providerForm.baseURL} onChange={e=>setProviderForm(v=>({...v,baseURL:e.target.value}))} placeholder="https://api.example.com/v1"/></label></div><label>{t('ui.apiKey')}<input type="password" autoComplete="off" value={providerForm.apiKey} onChange={e=>setProviderForm(v=>({...v,apiKey:e.target.value}))} placeholder={providerForm.id?t('ui.leaveBlankToKeepTheKey'):t('ui.pasteYourProviderKey')}/></label><label className="checkbox-label"><input type="checkbox" checked={providerForm.supportsImages} onChange={e=>setProviderForm(v=>({...v,supportsImages:e.target.checked}))}/>{t('ui.theApiAndModelSupportImages')}</label><div className="form-actions"><button className="primary" disabled={!!working||busy} onClick={()=>guard(async()=>{const s=await api('saveProvider',providerForm);setState(s);const id=providerForm.id||s.providers[s.providers.length-1].id;setProviderForm({id:'',name:'',baseURL:'',apiKey:'',supportsImages:false});await syncModels(id);setNotice(t('ui.providerConnected'));},t('ui.checkingApi'))}>{working||t('ui.saveAndCheck')}</button></div>
        <details className="advanced"><summary>{t('ui.modelById')}</summary><label>{t('ui.modelId')}<div className="input-button"><input placeholder="model-id" value={manualModel} onChange={e=>setManualModel(e.target.value)}/><button className="secondary" disabled={!manualModel.trim()||!state?.providerId||busy} onClick={()=>guard(async()=>{await api('settings',{model:manualModel.trim()});await refresh();setModal('');})}>{t('ui.select')}</button></div></label></details>
      </div>}
      {modal==='archicad'&&<div className="modal-body">
        <div className={`status-banner ${connected?'success':''}`}><Cable size={21}/><div><strong>{connected?t('ui.archicadConnected',{value0:state?.connection.data?.archicad_version||''}):t('ui.openAProjectInArchicad')}</strong><small>{connected?projectLabel:state?.connection.message}</small></div></div>
        <div className="form-actions"><button className="secondary" onClick={()=>guard(()=>api('launchArchicad'))}><FolderOpen size={15}/>{t('ui.openPln')}</button><button className="primary" onClick={connect} disabled={busy||!!working}><RotateCw size={15}/>{working===t('ui.connecting')?t('ui.connectingAlt'):t('ui.connect')}</button></div>
        <details className="advanced"><summary>{t('ui.installTapir')}</summary><p className="muted">{t('ui.chooseYourArchicadVersionIfItIs')}</p><div className="input-button"><select aria-label={t('ui.archicadVersionForTapir')} value={acVersion} onChange={e=>setAcVersion(e.target.value)}>{[25,26,27,28,29,30].map(v=><option key={v} value={v}>Archicad {v}</option>)}</select><button className="primary" disabled={!!working} onClick={()=>guard(async()=>{const r=await api('installTapir',{version:Number(acVersion)});setNotice(r.message);},t('ui.downloadingTapir'))}><Download size={15}/>{working===t('ui.downloadingTapir')?t('ui.downloading'):t('ui.install')}</button></div></details>
        <details className="advanced"><summary>{t('ui.chooseArchicadInstance')}</summary><label>{t('ui.port')}<select value={port} onChange={e=>setPort(e.target.value)}><option value="">{t('ui.automatic')}</option>{Array.from({length:21},(_,i)=>String(19723+i)).map(p=><option key={p} value={p}>{p}{instances.some(x=>String(x.port)===p)?t('ui.open'):''}</option>)}</select></label><div className="form-actions"><button className="text-button" onClick={()=>guard(async()=>{const i=await api('scan');setInstances(i);setNotice(i.length?t('ui.found',{value0:i.length}):t('ui.noRunningArchicadFound'));},t('ui.findingArchicad'))}>{t('ui.findRunningInstances')}</button><button className="secondary" disabled={busy} onClick={()=>guard(async()=>{await api('settings',{archicadPort:port});await connect();})}>{t('ui.apply')}</button></div></details>
        <button className="settings-link" onClick={openTools}><Wrench size={16}/>{t('ui.archicadTools')}<span>{state?.toolCount||''}</span><ChevronRight size={15}/></button>
      </div>}
      {modal==='about'&&<div className="modal-body about"><img src="./helmet.png" alt={t('ui.yellowHardHat')} width="64"/><h3>Archi Helper {update?.version||'0.1.0'}</h3><button className="text-button" onClick={()=>guard(()=>api('external',{url:'https://github.com/streletskiy/archi-helper'}))}>{t('ui.projectOnGithub')}{' '}<ExternalLink size={14}/></button><p>{t('ui.architectSAssistant')}</p><label className="language-setting">{t('ui.language')}<select aria-label={t('ui.language')} value={language} disabled={busy||!!working} onChange={e=>{const language=e.target.value;guard(async()=>{const s=await api('settings',{language});setLanguage(s.language);setState(s);});}}><option value="ru">{t('ui.languageRussian')}</option><option value="en">{t('ui.languageEnglish')}</option></select></label><p className="muted">{update?.status==='disabled'?t('ui.updatesAreAvailableOnGithubReleases'):update?.status==='error'?t('ui.couldNotCheckForUpdates'):update?.status==='current'?t('ui.youHaveTheLatestVersion'):t('ui.updatesInstallAutomatically')}</p>{update?.status!=='disabled'&&<button className="text-button" onClick={()=>guard(async()=>setUpdate(await api('checkUpdates')))}>{t('ui.checkForUpdates')}</button>}<p className="muted">{t('ui.pythonUvAndMcpAreIncluded')}<br/>{t('ui.historyIsStoredInYourProjectFolder')}<br/>{t('ui.requestsAreSentToYourChosenAi')}</p><button className="text-button" onClick={()=>guard(()=>api('external',{url:'https://github.com/ENZYME-APD/tapir-archicad-automation'}))}>Tapir Archicad Automation <ExternalLink size={14}/></button></div>}
      {modal==='tools'&&<div className="tool-browser"><div className="tool-browser-list"><div className="sidebar-search"><Search size={15}/><input aria-label={t('ui.findTool')} placeholder={t('ui.nameOrDescription')} value={toolSearch} onChange={e=>setToolSearch(e.target.value)}/></div><small>{t('ui.toolCount',{count:filteredTools.length})}</small><div>{filteredTools.map(t=><button key={t.key} className={selectedTool?.key===t.key?'selected':''} onClick={()=>chooseTool(t)}><span>{t.readOnly?<Search size={13}/>:<Wrench size={13}/>}</span>{t.name}</button>)}</div></div><div className="tool-browser-detail">{selectedTool?<><div className="tool-name"><h3>{selectedTool.name}</h3><span className={`tag ${selectedTool.readOnly?'green':''}`}>{selectedTool.readOnly?t('ui.read'):t('ui.modify')}</span></div><p className="muted">{selectedTool.description}</p><details><summary>{t('ui.parameterSchema')}</summary><pre>{pretty(selectedTool.inputSchema)}</pre></details><label>{t('ui.jsonParameters')}<textarea className="code-input" value={toolArgs} onChange={e=>setToolArgs(e.target.value)} rows={9}/></label><button className="primary" disabled={!project||!session||busy} onClick={()=>guard(async()=>{const args=JSON.parse(toolArgs);setModal('');await api('directTool',{projectId:project?.id,sessionId:session?.id,key:selectedTool.key,args,mode});})}><Play size={15}/>{t('ui.run')}</button></>:<div className="tool-placeholder"><Wrench size={30}/><p>{t('ui.chooseAToolOnTheLeft')}</p></div>}</div></div>}
      {modal==='rename'&&<Rename title={session?.title||''} onSave={title=>guard(async()=>{await api('renameSession',{projectId:project?.id,id:session?.id,title});setSession(s=>s?{...s,title}:s);await refreshSessions();setModal('');})}/>}
    </section></div>}
  </div>;
}
function Rename({title,onSave}:{title:string;onSave:(s:string)=>void}){const [value,setValue]=useState(title);return <div className="modal-body"><label>{t('ui.name')}<input autoFocus value={value} onChange={e=>setValue(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')onSave(value);}}/></label><div className="form-actions"><button className="primary" onClick={()=>onSave(value)}>{t('ui.save')}</button></div></div>;}
function UpdateNotice({update,onLater}:{update:any;onLater:()=>void}){
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(update?.status!=='countdown')return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[update?.status,update?.restartAt]);
  if(!['downloading','ready','countdown','installing'].includes(update?.status))return null;
  const text=update.status==='downloading'?t('ui.downloadingUpdate',{value0:update.percent||0}):update.status==='countdown'?t('ui.updateReadyRestartingInS',{value0:Math.max(0,Math.ceil((update.restartAt-now)/1000))}):update.status==='installing'?t('ui.installingUpdate'):update.deferred?t('ui.willUpdateOnNextLaunch'):t('ui.updateReadyWaitingForWorkToFinish');
  return <div className="update-notice" role="status"><span>{text}</span>{['ready','countdown'].includes(update.status)&&!update.deferred&&<button onClick={onLater}>{t('ui.later')}</button>}</div>;
}
createRoot(document.getElementById('root')!).render(<App/>);

import { t, setLanguage, useLanguage } from './i18n';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, Folder, FolderOpen, ArrowUp, ArrowDown, ArrowUpRight, Settings, X, Minus, Square, PanelRightClose, PanelRightOpen, Paperclip, ChevronDown, Check, Circle, RotateCw, Search, Box, Layers, Ruler, FileText, Download, Share, Archive, ArchiveRestore, Sparkles, ShieldCheck, ShieldAlert, Wrench, ChevronRight, MessageSquare, Cable, Cpu, ExternalLink, Play, StopCircle, Pencil, Trash2, Languages, Brain, Eye, Info, CircleAlert } from 'lucide-react';
import './style.css';
import './theme.css';
import { ThemeControl, type ThemeMode } from './ThemeControl';
import { suggestions } from './suggestions';
import { KnowledgeLibrary, type KnowledgeSelection } from './KnowledgeLibrary';
import { KnowledgeSlash, type KnowledgeSlashHandle } from './KnowledgeSlash';
import { BookOpen } from 'lucide-react';
import { Mascot } from './Mascot';
import { MessageBubble } from './MessageBubble';
import { Onboarding } from './Onboarding';
import { AnimatedMessageContent } from './AnimatedMessageContent';
import {activityLabel,visibleMessages} from './chat-presentation.mjs';
import {useStream} from './useStream';
import {VirtualMessages} from './VirtualMessages';
import {TapirSettings} from './TapirSettings';
import {maskAccount} from './maskAccount';
import { OAuthConnect, ProviderPrompt, type ProviderPromptData } from './ProviderConnections';
import { providerDefinitions } from '../electron/provider-definitions.mjs';
import { ActionMenu, ProjectPicker, type Project } from './WorkspaceControls';
import { needsModelRefresh, reasoningProfile, selectedEffort } from '../electron/reasoning.mjs';
import { ModelSelect } from './ModelSelect';
import { TelemetrySettings, WorkflowReview, type TelemetryState } from './TelemetrySettings';

declare global { interface Window { archi: {call:(method:string,input?:unknown)=>Promise<any>;attachFiles:(input:{projectId:string;sessionId:string},files:File[])=>Promise<string[]>;onEvent:(cb:(e:any)=>void)=>()=>void} } }
const INBOX_ID='00000000-0000-0000-0000-000000000000';
type Model={id:string;name:string;reasoningEfforts?:string[];contextWindow?:number};
type Provider={id:string;name:string;baseURL:string;hasKey:boolean;definitionId?:string;oauth?:{status:string;accountName:string;planEnabled?:boolean};catalogVersion?:number;catalogUpdatedAt?:number;models:Model[];supportsImages?:boolean;reasoningFormat?:string;reasoningEfforts?:string[]};
type Message={id:string;role:string;text:string;at?:number;usageAction?:string;name?:string;status?:string;summary?:string;args?:unknown;artifact?:{path:string;bytes:number};model?:string};
type QueuedMessage={id:string;text:string;attachments:string[];knowledge?:KnowledgeSelection[];model:string;delivery:'queue'|'steer'};
type Session={id:string;title:string;messages:Message[];updatedAt:number;archivedAt?:number;count?:number;pendingMessages?:QueuedMessage[];queuePaused?:boolean};
type SessionGroup={projectId:string;sessions:Session[];error?:string};
type Tool={key:string;name:string;description:string;readOnly:boolean;inputSchema:any};
type TapirDownloadProgress={status:'checking'|'downloading'|'verifying'|'installing'|'launched'|'error';version:string;percent:number;transferred:number;total:number;bytesPerSecond:number;message:string};
type State={telemetry?:TelemetryState;showToolDetails?:boolean;theme?:ThemeMode;onboardingVersion?:number;appVersion?:string;updateApplied?:boolean;updateOnly?:boolean;runtimeInfo?:{pythonVersion?:string};language:string;projects:Project[];providers:Provider[];providerId:string;model:string;reasoningEffort?:string;permissionMode?:string;archicadPort:string;connection:any;toolCount:number;runtimeReady:boolean;busy:boolean;activeSession?:string;activeProject?:string;canSteer?:boolean;update?:any;tapirProgress?:TapirDownloadProgress};
const providerToForm=(p:Provider)=>({id:p.id,name:p.name,baseURL:p.baseURL,apiKey:'',definitionId:p.definitionId||'',oauth:p.oauth,supportsImages:p.supportsImages===true,reasoningFormat:p.reasoningFormat||'auto',reasoningEfforts:p.reasoningEfforts?.join(', ')||''});
const emptyProvider=()=>({id:'',name:'',baseURL:'',apiKey:'',definitionId:'',oauth:undefined as Provider['oauth'],supportsImages:false,reasoningFormat:'auto',reasoningEfforts:''});
const effortLabel=(value:string)=>t(({none:'ui.reasoningNone',minimal:'ui.reasoningMinimal',low:'ui.reasoningLow',medium:'ui.reasoningMedium',high:'ui.reasoningHigh',xhigh:'ui.reasoningXhigh',max:'ui.reasoningMax',ultra:'ui.reasoningUltra'} as const)[value as 'xhigh']);
const api=(method:string,input?:unknown)=>window.archi.call(method,input);
const pretty=(v:unknown)=>typeof v==='string'?v:JSON.stringify(v,null,2);
const bytes=(n:number)=>n>1048576?t('ui.mb',{value0:(n/1048576).toFixed(1)}):n>1024?t('ui.kb',{value0:Math.round(n/1024)}):t('ui.b',{value0:n});
const labels=():Record<string,string>=>({get_knowledge:t('ui.knowledge'),get_api_catalog:t('ui.apiCatalog'),export_layouts_pdf:t('ui.exportLayoutsPdf'),find_tools:t('ui.findTools'),call_archicad:t('ui.archicadCommand'),list_files:t('ui.projectFiles'),read_file:t('ui.readResult'),view_image:t('ui.viewImage'),write_file:t('ui.saveFile'),run_python:t('ui.processData')});
function IconButton({title,onClick,children,disabled=false}:{title:string;onClick:()=>void;children:React.ReactNode;disabled?:boolean}) {
  return <button className="icon-button" title={title} aria-label={title} onClick={onClick} disabled={disabled}>{children}</button>;
}
function App(){
  const language=useLanguage();
  useEffect(()=>{document.documentElement.lang=language;document.title=`Archi Helper — ${t('ui.architectSAssistant')}`;},[language]);
  const [state,setState]=useState<State|null>(null),[project,setProject]=useState<Project|null>(null),[session,setSession]=useState<Session|null>(null);
  useLayoutEffect(()=>{document.documentElement.dataset.theme=state?.theme||'system';},[state?.theme]);
  const [selectedKnowledge,setSelectedKnowledge]=useState<KnowledgeSelection[]>([]);
  const [cursor,setCursor]=useState(0),[slashDismissed,setSlashDismissed]=useState(false),[activeKnowledgeOption,setActiveKnowledgeOption]=useState<string|undefined>();
  const slashPicker=useRef<KnowledgeSlashHandle>(null);
  const [draft,setDraft]=useState(''),[mode,setMode]=useState('full'),[busy,setBusy]=useState(false),[approval,setApproval]=useState<any>(null);
  const {stream,appendStream,removeStream,resetStreams,animatedIds,markAnimated}=useStream();
  const messageGroups=useMemo(()=>groupMessages(visibleMessages(session?.messages||[],state?.showToolDetails)),[session?.messages,state?.showToolDetails,language]);
  const streamed=Object.entries(stream).filter(([,text])=>text.length>0),streamKey=Object.keys(stream).join('\0');
  const messageIds=useMemo(()=>[...messageGroups.map(group=>group.id),...Object.keys(stream)],[messageGroups,streamKey]);
  const [providerPrompt,setProviderPrompt]=useState<ProviderPromptData|null>(null);
  const [update,setUpdate]=useState<any>(null),[choosing,setChoosing]=useState(false);
  const [tapirProgress,setTapirProgress]=useState<TapirDownloadProgress|null>(null);
  const [submitting,setSubmitting]=useState(false);
  const [dragging,setDragging]=useState(false),dragDepth=useRef(0);
  const [onboarding,setOnboarding]=useState<false|'auto'|'manual'>(false);
  const onboardingOffered=useRef(false);
  const providerReady=!!state?.model&&!!state.providers.find(p=>p.id===state.providerId&&p.hasKey&&(!p.oauth||p.oauth.status==='connected'&&p.oauth.planEnabled!==false));
  const [showScrollToLatest,setShowScrollToLatest]=useState(false);
  const followLatest=useRef(true),conversation=useRef<HTMLDivElement>(null),conversationContent=useRef<HTMLDivElement>(null);
  const sending=useRef(false),retryRequest=useRef<{key:string;id:string}|null>(null);
  const updateBlocking=!state||state.updateOnly===true||(!update?.deferred&&['checking','downloading','ready','countdown','installing','error'].includes(update?.status));
  const [modal,setModal]=useState(''),[notice,setNotice]=useState<{text:string;tone:'success'|'error'}|null>(null),[working,setWorking]=useState(''),[attachments,setAttachments]=useState<string[]>([]);
  const [projectName,setProjectName]=useState(''),[search,setSearch]=useState(''),[toolSearch,setToolSearch]=useState(''),[tools,setTools]=useState<Tool[]>([]),[selectedTool,setSelectedTool]=useState<Tool|null>(null),[toolArgs,setToolArgs]=useState('{}');
  const [archivedSessions,setArchivedSessions]=useState(false),[projectArchive,setProjectArchive]=useState(false),[projectSearch,setProjectSearch]=useState(''),[projectIntent,setProjectIntent]=useState<'browse'|'draft'>('browse');
  const [renamingProject,setRenamingProject]=useState<Project|null>(null),[deletion,setDeletion]=useState<{kind:'project'|'session';id:string;name:string;count?:number;projectId?:string}|null>(null),[navigating,setNavigating]=useState(false);
  const [sessionGroups,setSessionGroups]=useState<SessionGroup[]>([]),[collapsedProjects,setCollapsedProjects]=useState<Record<string,boolean>>({}),[shownSessions,setShownSessions]=useState<Record<string,number>>({});
  const savedDrafts=useRef(new Map<string,{text:string;files:string[];knowledge:KnowledgeSelection[]}>());
  const navigation=useRef(false);
  const [providerForm,setProviderForm]=useState(emptyProvider),[manualModel,setManualModel]=useState(''),[port,setPort]=useState(''),[instances,setInstances]=useState<any[]>([]);
  const providerEditor=useRef<HTMLDivElement>(null);
  const sessionRef=useRef<string|undefined>(undefined),projectRef=useRef<Project|null>(null),textInput=useRef<HTMLTextAreaElement>(null);
  const draftSnapshot=useRef({text:draft,files:attachments,knowledge:selectedKnowledge});
  draftSnapshot.current={text:draft,files:attachments,knowledge:selectedKnowledge};
  sessionRef.current=session?.id;projectRef.current=project;
  const projectId=project?.id||INBOX_ID,readOnly=!!project?.archivedAt||!!session?.archivedAt;
  const slashMatch=!slashDismissed&&!modal&&!readOnly&&!navigating?draft.slice(0,cursor).match(/(?:^|\s)\/([^\s/]*)$/u):null;
  const slash=slashMatch?{query:slashMatch[1],start:cursor-slashMatch[1].length-1,end:cursor}:null;
  const attachSlash=(entry:KnowledgeSelection)=>{if(!slash||selectedKnowledge.length>=8)return;const caret=slash.start;setSelectedKnowledge(items=>items.some(item=>item.id===entry.id)?items:[...items,entry]);setDraft(value=>value.slice(0,slash.start)+value.slice(slash.end));setCursor(caret);setSlashDismissed(true);requestAnimationFrame(()=>{textInput.current?.focus();textInput.current?.setSelectionRange(caret,caret);});};
  const workspaceLocked=busy||submitting||navigating||!!working;
  const notify=useCallback((text:string,tone:'success'|'error'='success')=>setNotice({text,tone}),[]);
  const guard=useCallback(async(fn:()=>Promise<any>,label='')=>{try{if(label)setWorking(label);return await fn();}catch(e){notify((e as Error).message,'error');}finally{if(label)setWorking('');}},[notify]);
  const finishOnboarding=useCallback(()=>{
    onboardingOffered.current=true;setOnboarding(false);
    void guard(async()=>{setState(await api('completeOnboarding'));});
  },[guard]);
  useEffect(()=>{
    if(state?.onboardingVersion||!providerReady||onboardingOffered.current||modal||updateBlocking||workspaceLocked||providerPrompt||approval||draft.trim()||attachments.length||readOnly)return;
    const timer=setTimeout(()=>{onboardingOffered.current=true;setOnboarding('auto');},750);
    return()=>clearTimeout(timer);
  },[state?.onboardingVersion,providerReady,modal,updateBlocking,workspaceLocked,providerPrompt,approval,draft,attachments.length,readOnly]);
  useEffect(()=>{
    if(onboarding&&(modal||busy||approval||providerPrompt||updateBlocking))finishOnboarding();
  },[onboarding,modal,busy,approval,providerPrompt,updateBlocking,finishOnboarding]);
  const copyMessage=async(text:string)=>{
    try{await navigator.clipboard.writeText(text);return true;}
    catch{notify(t('ui.couldNotCopyMessage'),'error');return false;}
  };
  useEffect(()=>{
    if(notice?.tone!=='success'||updateBlocking)return;
    const timer=setTimeout(()=>setNotice(null),4000);
    return()=>clearTimeout(timer);
  },[notice,updateBlocking]);
  const refresh=async()=>{const s=await api('bootstrap');setLanguage(s.language);setState(s);setBusy(s.busy);setProviderPrompt(s.providerPrompt||null);setApproval(s.approval&&s.approval.sessionId===s.activeSession?s.approval.approval:null);setUpdate(s.update);setTapirProgress(s.tapirProgress||null);setPort(s.archicadPort);setMode(s.permissionMode||'full');return s;};
  const rememberDraft=()=>savedDrafts.current.set(sessionRef.current||`draft:${projectRef.current?.id||INBOX_ID}`,{text:draftSnapshot.current.text,files:[...draftSnapshot.current.files],knowledge:[...draftSnapshot.current.knowledge]});
  const restoreDraft=(p:Project|null,s?:Session|null)=>{const saved=savedDrafts.current.get(s?.id||`draft:${p?.id||INBOX_ID}`);setDraft(saved?.text||'');setAttachments(saved?.files||[]);setSelectedKnowledge(saved?.knowledge||[]);};
  const refreshSessions=async(p=projectRef.current)=>{const id=p?.id||INBOX_ID,groups:SessionGroup[]=await api('sessionIndex'),list=groups.find(group=>group.projectId===id)?.sessions||[];setSessionGroups(groups);return list;};
  const openProject=async(p:Project|null,activeSession?:string)=>{
    if(busy||sending.current||navigation.current)return;
    rememberDraft();
    navigation.current=true;setNavigating(true);
    try{
      const id=p?.id||INBOX_ID,list:Session[]=await api('sessions',{projectId:id}),target=activeSession?list.find(s=>s.id===activeSession):list.find(s=>!s.archivedAt);
      const next=target?await api('session',{projectId:id,id:target.id}):null;
      projectRef.current=p;sessionRef.current=next?.id;setProject(p);setSession(next);setArchivedSessions(!!p?.archivedAt||!!next?.archivedAt);setSearch('');resetStreams();restoreDraft(p,next);
    }finally{navigation.current=false;setNavigating(false);}
  };
  useEffect(()=>{
    guard(async()=>{
      const s=await refresh();if(s.updateApplied)notify(t('ui.updateApplied',{version:s.appVersion}));
      if(!s.providers.some((p:Provider)=>p.hasKey&&(!p.oauth||p.oauth.status==='connected'&&p.oauth.planEnabled!==false)))setModal('providers');
      await refreshSessions(null);if(s.activeSession)await openProject(s.projects.find((p:Project)=>p.id===s.activeProject)||null,s.activeSession);
      const provider=s.providers.find((p:Provider)=>p.id===s.providerId);
      if(provider && needsModelRefresh(provider))await syncModels(provider.id);
    });
    return window.archi.onEvent(e=>{
      if(e.type==='provider-prompt')setProviderPrompt(e.prompt);
      if(e.type==='update')setUpdate(e.update);
      if(e.type==='tapir-progress')setTapirProgress(e.progress);
      if(e.type==='connection')setState(s=>s?{...s,connection:e.connection,toolCount:e.toolCount,runtimeReady:e.runtimeReady}:s);
      if(e.type==='busy'){setBusy(e.busy);setState(s=>s?{...s,busy:e.busy,canSteer:e.canSteer,activeSession:e.busy?e.sessionId:undefined,activeProject:e.busy?e.projectId:undefined}:s);if(!e.busy){setApproval(null);guard(async()=>{await refresh();await refreshSessions();});}}
      if(e.type==='queue-error')notify(e.message,'error');
      if(e.sessionId!==sessionRef.current)return;
      if(e.type==='queue')setSession(s=>s?{...s,pendingMessages:e.pendingMessages,queuePaused:e.queuePaused}:s);
      if(e.type==='stream-reset')removeStream(e.id);
      if(e.type==='message'){
        if(e.message.role==='assistant')markAnimated(e.message.id);
        setSession(s=>s?{...s,messages:[...s.messages.filter(m=>m.id!==e.message.id),e.message]}:s);
        removeStream(e.message.id);
      }
      if(e.type==='delta')appendStream(e.id,e.delta);
      if(e.type==='approval'){setApproval(e.approval);setModal('');}
      if(e.type==='approval-done')setApproval(null);
    });
  },[]);
  const scrollToLatest=useCallback(()=>{
    const element=conversation.current;if(!element)return;
    followLatest.current=true;
    element.scrollTo({top:element.scrollHeight,behavior:'instant'});
    setShowScrollToLatest(false);
  },[]);
  useLayoutEffect(()=>{
    const element=conversation.current,content=conversationContent.current;
    if(!element||!content)return;
    // Opening a chat starts at the latest message, before the first paint.
    // Follow later image/layout changes only while the reader stays at the end.
    let frame=0;
    const settle=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(followLatest.current)scrollToLatest();});};
    scrollToLatest();settle();
    const onScroll=()=>{
      const atEnd=element.scrollHeight-element.clientHeight-element.scrollTop<=48;
      followLatest.current=atEnd;setShowScrollToLatest(!atEnd);
    };
    const observer=new ResizeObserver(()=>{if(followLatest.current){scrollToLatest();settle();}else onScroll();});
    observer.observe(content);observer.observe(element);
    element.addEventListener('scroll',onScroll,{passive:true});
    return()=>{cancelAnimationFrame(frame);observer.disconnect();element.removeEventListener('scroll',onScroll);};
  },[project?.id,session?.id,updateBlocking,scrollToLatest]);
  useLayoutEffect(()=>{if(followLatest.current)scrollToLatest();},[session?.messages,stream,approval,scrollToLatest]);
  const syncModels=async(id:string)=>{try{await api('models',{id});}finally{await refresh();}};
  const oauthConnected=async({providerId,state:next}:{providerId:string;state:State})=>{
    setState(next);const provider=next.providers.find(p=>p.id===providerId)!;setProviderForm(providerToForm(provider));
    if(provider.oauth?.planEnabled!==false){await syncModels(providerId);notify(t('ui.providerConnected'));}
  };
  const chooseSettings=(input:Record<string,string>)=>guard(async()=>{
    setChoosing(true);
    try{const s=await api('settings',input);setState(s);if(input.providerId){const p=s.providers.find((p:Provider)=>p.id===input.providerId);if(p&&needsModelRefresh(p))await syncModels(p.id);}}
    finally{setChoosing(false);}
  });
  const newSession=(p:Project|null=null)=>guard(async()=>{if(workspaceLocked||sending.current||p?.archivedAt)return;rememberDraft();setProject(p);projectRef.current=p;setSession(null);sessionRef.current=undefined;restoreDraft(p);resetStreams();setArchivedSessions(false);setSearch('');await refreshSessions(p);textInput.current?.focus();});
  const ensureSession=async()=>{
    if(session)return session;
    const s=await api('newSession',{projectId});savedDrafts.current.delete(`draft:${projectId}`);setSession(s);sessionRef.current=s.id;await refreshSessions();return s as Session;
  };
  const importAttachments=(source:'dialog'|'clipboard'|File[])=>guard(async()=>{
    if(readOnly||workspaceLocked||sending.current||modal)return;
    sending.current=true;setSubmitting(true);
    try {
      const hadSession=!!session,current=await ensureSession(),input={projectId,sessionId:current.id};
      const files=Array.isArray(source)?await window.archi.attachFiles(input,source):await api(source==='dialog'?'attach':'pasteAttachments',input);
      if(!files.length&&!hadSession){await api('deleteSession',{projectId,id:current.id});setSession(null);sessionRef.current=undefined;await refreshSessions();}
      else setAttachments(value=>[...new Set<string>([...value,...files])]);
    }finally{sending.current=false;setSubmitting(false);textInput.current?.focus();}
  });
  const pasteAttachments=(event:React.ClipboardEvent<HTMLTextAreaElement>)=>{
    const files=Array.from(event.clipboardData.files);
    if(!files.length&&event.clipboardData.getData('text/plain')&&!event.clipboardData.types.includes('text/uri-list'))return;
    event.preventDefault();void importAttachments(files.length?files:'clipboard');
  };
  useEffect(()=>{
    const preventNavigation=(event:DragEvent)=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();};
    window.addEventListener('dragover',preventNavigation);window.addEventListener('drop',preventNavigation);
    return()=>{window.removeEventListener('dragover',preventNavigation);window.removeEventListener('drop',preventNavigation);};
  },[]);
  useEffect(()=>{dragDepth.current=0;setDragging(false);},[projectId,session?.id,modal]);
  const chooseDraftProject=(p:Project|null)=>guard(async()=>{
    if(workspaceLocked||sending.current||navigation.current)return;
    navigation.current=true;setNavigating(true);
    try{
      if(session){const next=await api('moveDraft',{projectId,id:session.id,targetProjectId:p?.id||INBOX_ID});setSession(next);}
      projectRef.current=p;setProject(p);setSelectedKnowledge(items=>items.filter(item=>!item.id.startsWith('user:projects/')));setSearch('');setArchivedSessions(false);await refreshSessions(p);textInput.current?.focus();
    }finally{navigation.current=false;setNavigating(false);}
  });
  const openProjects=(intent:'browse'|'draft'='browse')=>{setProjectIntent(intent);setProjectArchive(false);setProjectSearch('');setProjectName('');setModal('projects');};
  const send=(delivery:'queue'|'steer'='queue')=>guard(async()=>{
    if(readOnly||navigating||(!draft.trim()&&!attachments.length)||sending.current||choosing||!state?.providerId||!state?.model)return;
    sending.current=true;setSubmitting(true);
    const text=draft,files=[...attachments],knowledge=[...selectedKnowledge];
    let current;try{current=await ensureSession();}catch(error){sending.current=false;setSubmitting(false);throw error;}
    const input={projectId,sessionId:current.id,text,attachments:files,knowledgeIds:knowledge.map(item=>item.id),providerId:state.providerId,model:state.model,mode,delivery};
    const key=JSON.stringify(input),id=retryRequest.current?.key===key?retryRequest.current.id:crypto.randomUUID();
    retryRequest.current={key,id};sending.current=true;setSubmitting(true);setDraft('');setAttachments([]);setSelectedKnowledge([]);
    try{await api('send',{...input,id});retryRequest.current=null;}
    catch(error){setDraft(current=>text?(current?`${text}\n\n${current}`:text):current);setAttachments(current=>[...new Set([...files,...current])]);setSelectedKnowledge(current=>[...knowledge,...current.filter(item=>!knowledge.some(old=>old.id===item.id))]);throw error;}
    finally{sending.current=false;setSubmitting(false);textInput.current?.focus();}
  });
  const changeQueued=(item:QueuedMessage,action:'steer'|'remove'|'edit')=>guard(async()=>{
    if(!session||sending.current)return;
    sending.current=true;setSubmitting(true);
    try{
      const value=await api('queuedMessage',{projectId,sessionId:session.id,id:item.id,action:action==='edit'?'remove':action});
      if(action==='edit'){setSelectedKnowledge(current=>[...(value.knowledge||[]).map((item:KnowledgeSelection)=>({id:item.id,title:item.title})),...current.filter(item=>!value.knowledge?.some((old:KnowledgeSelection)=>old.id===item.id))]);setDraft(current=>current?`${value.text}\n\n${current}`:value.text);setAttachments(current=>[...new Set<string>([...value.attachments,...current])]);textInput.current?.focus();}
    }finally{sending.current=false;setSubmitting(false);}
  });
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(updateBlocking)return;
      if(event.ctrlKey && event.key.toLowerCase()==='n'){event.preventDefault();if(!workspaceLocked)newSession();}
      if(event.key==='Escape'&&!working&&modal!=='knowledge')setModal('');
    };
    window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
  },[project,workspaceLocked,updateBlocking,working,modal]);
  useEffect(()=>{
    if(!modal||modal==='knowledge')return;
    const previous=document.activeElement as HTMLElement|null;
    const dialog=document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable=()=>Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary')||[]).filter(x=>x.getClientRects().length>0);
    const frame=requestAnimationFrame(()=>(dialog?.querySelector<HTMLElement>('.delete-confirm .secondary, input:not(:disabled), textarea:not(:disabled)')||focusable()[0])?.focus());
    const trap=(e:KeyboardEvent)=>{if(e.key!=='Tab')return;const items=focusable(),first=items[0],last=items[items.length-1];if(!first)return;if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}};
    document.addEventListener('keydown',trap);return()=>{cancelAnimationFrame(frame);document.removeEventListener('keydown',trap);previous?.focus();};
  },[modal]);
  useEffect(()=>{api('updateIdle',{idle:!busy&&!draft.trim()&&!attachments.length&&!session?.pendingMessages?.length&&(!modal||updateBlocking)&&!approval}).catch(()=>{});},[busy,draft,attachments.length,session?.pendingMessages?.length,modal,approval,updateBlocking]);
  const connect=()=>guard(async()=>{await api('connect');await refresh();},t('ui.connecting'));
  const openTools=()=>guard(async()=>{setTools(await api('tools'));setModal('tools');});
  const chooseTool=(t:Tool)=>{
    setSelectedTool(t);const args:Record<string,unknown>={};
    for(const k of t.inputSchema.required||[]) {const prop=t.inputSchema.properties?.[k];args[k]=prop?.enum?.[0]??(prop?.type==='array'?[]:prop?.type==='object'?{}:prop?.type==='number'||prop?.type==='integer'?0:prop?.type==='boolean'?false:'');}
    setToolArgs(JSON.stringify(args,null,2));
  };
  const reveal=(relative?:string)=>guard(()=>api('reveal',{projectId,sessionId:session?.id,relative}));
  const openMessageLink=useCallback((href?:string)=>{if(href)return guard(()=>/^https:/i.test(href)?api('external',{url:href}):api('reveal',{projectId,sessionId:session?.id,relative:href}));},[guard,projectId,session?.id]);
  const selectSession=(id:string,p:Project|null=projectRef.current)=>guard(async()=>{
    if(workspaceLocked||sending.current||navigation.current)return;
    rememberDraft();
    navigation.current=true;setNavigating(true);
    try{const next=await api('session',{projectId:p?.id||INBOX_ID,id});setProject(p);projectRef.current=p;setSession(next);sessionRef.current=id;resetStreams();restoreDraft(p,next);}
    finally{navigation.current=false;setNavigating(false);}
  });
  const archiveSession=(item:Session,p:Project|null=projectRef.current)=>guard(async()=>{
    if(workspaceLocked)return;
    await api('archiveSession',{projectId:p?.id||INBOX_ID,id:item.id,archived:!item.archivedAt});
    if(session?.id===item.id){setSession({...session,archivedAt:item.archivedAt?undefined:Date.now()});setArchivedSessions(!!p?.archivedAt||!item.archivedAt);}
    await refreshSessions();notify(t(item.archivedAt?'ui.sessionRestored':'ui.sessionArchived'));
  },t('ui.savingChanges'));
  const archiveProject=(item:Project)=>guard(async()=>{
    const next=await api('archiveProject',{id:item.id,archived:!item.archivedAt});setState(next);
    if(project?.id===item.id){const p=next.projects.find((p:Project)=>p.id===item.id);projectRef.current=p;setProject(p);setArchivedSessions(!!p.archivedAt||!!session?.archivedAt);}
    notify(t(item.archivedAt?'ui.projectRestored':'ui.projectArchived'));
  },t('ui.savingChanges'));
  const requestProjectDeletion=(item:Project)=>guard(async()=>{
    const list=await api('sessions',{projectId:item.id}).catch(()=>null);setDeletion({kind:'project',id:item.id,name:item.name,count:list?.length});setModal('delete');
  });
  const deleteItem=()=>guard(async()=>{
    if(!deletion||busy||sending.current)return;
    if(deletion.kind==='project'){
      setState(await api('deleteProject',{id:deletion.id}));
      if(project?.id===deletion.id)await openProject(null);
      await refreshSessions();
    }else{
      await api('deleteSession',{projectId:deletion.projectId||projectId,id:deletion.id});savedDrafts.current.delete(deletion.id);
      const list=await refreshSessions();
      if(session?.id===deletion.id){const next=list.find(s=>!!s.archivedAt===archivedSessions);setSession(next?await api('session',{projectId,id:next.id}):null);setDraft('');setAttachments([]);resetStreams();}
    }
    setDeletion(null);setModal('');notify(t('ui.deleted'));
  },t('ui.deleting'));
  const createProject=(existing=false)=>guard(async()=>{
    const p=await api('createProject',{existing,name:projectName.trim()});
    if(!p)return;
    await refresh();
    if(projectIntent==='draft')await chooseDraftProject(p);else await openProject(p);
    await refreshSessions(p);
    setProjectName('');setModal('');
  },t('ui.creatingProject'));
  const sessionActions=(item:Session,p:Project|null=projectRef.current)=>[
    {label:t(item.archivedAt?'ui.restoreSession':'ui.archiveSession'),icon:item.archivedAt?<ArchiveRestore size={15}/>:<Archive size={15}/>,onClick:()=>archiveSession(item,p)},
    {label:t('ui.deleteSession'),icon:<Trash2 size={15}/>,danger:true,onClick:()=>{setDeletion({kind:'session',projectId:p?.id||INBOX_ID,id:item.id,name:item.title});setModal('delete');}}
  ];
  const selectedProvider=state?.providers.find(p=>p.id===state.providerId);
  const selectedDefinition=providerDefinitions.find(d=>d.id===selectedProvider?.definitionId);
  const editorDefinition=providerDefinitions.find(d=>d.id===providerForm.definitionId);
  const reasoning=reasoningProfile(selectedProvider,state?.model||'');
  const effort=selectedEffort(reasoning.efforts,state?.reasoningEffort||'xhigh');
  const isSettings=['preferences','providers','archicad','about'].includes(modal);
  const editProvider=(p?:Provider)=>{
    setProviderForm(p?providerToForm(p):emptyProvider());setManualModel('');
    requestAnimationFrame(()=>{providerEditor.current?.scrollIntoView({block:'nearest',behavior:'smooth'});providerEditor.current?.querySelector('input')?.focus({preventScroll:true});});
  };
  useEffect(()=>{
    document.querySelector('.settings-content')?.scrollTo(0,0);
    if(modal==='providers'&&!providerForm.id&&!providerForm.baseURL&&selectedProvider)setProviderForm(providerToForm(selectedProvider));
  },[modal]);
  const filteredTools=tools.filter(t=>`${t.name} ${t.description}`.toLowerCase().includes(toolSearch.toLowerCase()));
  const hasMessages=!!messageIds.length||!!approval;
  const sidebarProjects:(Project|null)[]=[...(state?.projects.filter(p=>archivedSessions||!p.archivedAt)||[]),null];
  const archiveCount=sessionGroups.reduce((count,g)=>count+g.sessions.filter(s=>s.archivedAt).length,0)+(state?.projects.filter(p=>p.archivedAt).length||0);
  const visibleProjects=state?.projects.filter(p=>!!p.archivedAt===projectArchive&&`${p.name} ${p.path}`.toLowerCase().includes(projectSearch.toLowerCase()))||[];
  const connected=state?.connection?.connected;
  const projectInfo=state?.connection.project;
  const projectLabel=projectInfo?.projectName||projectInfo?.name||projectInfo?.projectPath?.split(/[\\/]/).pop()||(projectInfo?.isUntitled?t('ui.untitledUnsaved'):t('ui.openProject'));
  const tapirVersion=connected&&typeof state?.connection.data?.tapir_installed==='string'?state.connection.data.tapir_installed:'';
  const tapirActive=!!tapirProgress&&['checking','downloading','verifying','installing'].includes(tapirProgress.status);
  const updateStatus=update?.status||'idle';
  const updateDescription=updateStatus==='disabled'?t('ui.updatesAreAvailableOnGithubReleases'):updateStatus==='error'?t('ui.updateRetryDescription'):updateStatus==='current'?t('ui.youHaveTheLatestVersion'):updateStatus==='checking'?t('ui.checkingUpdates'):updateStatus==='downloading'?t('ui.downloadingUpdate',{value0:update?.percent||0}):['ready','countdown'].includes(updateStatus)?t('ui.updateReadyWaitingForWorkToFinish'):updateStatus==='installing'?t('ui.installingUpdate'):t('ui.updatesInstallAutomatically');
  if(updateBlocking)return <UpdateNotice update={update||{status:'checking'}} updateOnly={state?.updateOnly===true} onLater={()=>guard(async()=>setUpdate(await api('deferUpdate')))} onRetry={()=>guard(async()=>setUpdate(await api('checkUpdates')))} onRestart={()=>guard(async()=>setUpdate(await api('restartUpdate')))}/>;
  return <div className="app">
    <div className="titlebar"><div className="titlebar-brand"><img src="./helmet.png" alt="" width="32"/>Archi Helper</div><div className="titlebar-actions"><label className="language-switch" title={t('ui.language')}><Languages size={15}/><select aria-label={t('ui.language')} value={language} disabled={!state||busy||choosing} onChange={e=>{const language=e.target.value;guard(async()=>{setChoosing(true);try{const s=await api('settings',{language});setLanguage(s.language);setState(s);}finally{setChoosing(false);}});}}><option value="ru">RU</option><option value="en">EN</option></select></label><ThemeControl value={state?.theme||'system'} disabled={!state} onChange={theme=>guard(async()=>{const next=await api('theme',{theme});setState(current=>current?{...current,theme:next.theme}:current);})}/><div className="window-controls"><IconButton title={t('ui.minimize')} onClick={()=>api('window',{action:'minimize'})}><Minus size={14}/></IconButton><IconButton title={t('ui.maximize')} onClick={()=>api('window',{action:'maximize'})}><Square size={11}/></IconButton><IconButton title={t('ui.close')} onClick={()=>api('window',{action:'close'})}><X size={15}/></IconButton></div></div></div>
    <div className="workspace">
      <aside className="sidebar">
        <button className="new-chat" aria-label={t('ui.createANewSession')} title="Ctrl + N" onClick={()=>newSession()} disabled={workspaceLocked}><Plus size={17}/>{t('ui.newSession')}</button>
        <div className="sidebar-search"><Search size={14}/><input aria-label={t('ui.searchProjectsAndSessions')} placeholder={t('ui.search')} value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div className="session-list-heading"><button className="manage-projects" disabled={workspaceLocked} onClick={()=>openProjects()}>{t(archivedSessions?'ui.archive':'ui.yourProjects')}<ChevronDown size={12}/></button><div><button title={t('ui.newProject')} aria-label={t('ui.newProject')} disabled={workspaceLocked} onClick={()=>openProjects()}><Plus size={15}/></button><button className={archivedSessions?'active':''} title={t(archivedSessions?'ui.showActiveSessions':'ui.showArchive')} aria-label={t(archivedSessions?'ui.showActiveSessions':'ui.showArchive')} aria-pressed={archivedSessions} onClick={()=>{setArchivedSessions(value=>!value);setSearch('');}}><Archive size={15}/>{archiveCount||''}</button></div></div>
        <div className="session-list grouped-session-list">
          {sidebarProjects.map(p=>{
            const id=p?.id||INBOX_ID,group=sessionGroups.find(g=>g.projectId===id),query=search.trim().toLowerCase(),name=p?.name||t('ui.withoutProject');
            const all=(group?.sessions||[]).filter(s=>archivedSessions?(p?.archivedAt||s.archivedAt):!s.archivedAt);
            const matches=all.filter(s=>name.toLowerCase().includes(query)||s.title.toLowerCase().includes(query));
            if(query&&!matches.length&&!name.toLowerCase().includes(query)||archivedSessions&&!p?.archivedAt&&!matches.length)return null;
            const visible=query?matches:matches.slice(0,shownSessions[id]||5),collapsed=!query&&collapsedProjects[id];
            return <section className="sidebar-project-group" key={id} aria-label={name}>
              <div className={`sidebar-project-heading ${projectId===id?'current-project':''}`}>
                <button className="project-collapse" aria-label={t(collapsed?'ui.expandProject':'ui.collapseProject',{name})} aria-expanded={!collapsed} onClick={()=>setCollapsedProjects(value=>({...value,[id]:!value[id]}))}><ChevronRight size={12} className={collapsed?'':'expanded'}/></button>
                <button className="sidebar-project-open" disabled={workspaceLocked} title={p?.path||name} onClick={()=>guard(()=>openProject(p))}>{p?.archivedAt?<Archive size={17}/>:<Folder size={17}/>}<span>{name}</span></button>
                {!p?.archivedAt&&<IconButton title={t('ui.newSessionInProject',{name})} disabled={workspaceLocked} onClick={()=>newSession(p)}><Plus size={14}/></IconButton>}
                {p&&<ActionMenu label={t('ui.projectActions',{name})} disabled={workspaceLocked} actions={[
                  {label:t('ui.renameProject'),icon:<Pencil size={15}/>,onClick:()=>{setRenamingProject(p);setModal('renameProject');}},
                  {label:t(p.archivedAt?'ui.restoreProject':'ui.archiveProject'),icon:p.archivedAt?<ArchiveRestore size={15}/>:<Archive size={15}/>,onClick:()=>archiveProject(p)},
                  {label:t('ui.deleteProject'),icon:<Trash2 size={15}/>,danger:true,onClick:()=>requestProjectDeletion(p)}
                ]}/>}
              </div>
              {!collapsed&&<div className="sidebar-project-sessions">{visible.map(s=><div className={`session-row ${session?.id===s.id?'selected':''}`} key={s.id}><button className="session-open" disabled={workspaceLocked} title={s.title} aria-current={session?.id===s.id?'page':undefined} onClick={()=>selectSession(s.id,p)}><span>{s.title}</span></button><ActionMenu label={t('ui.sessionActions',{name:s.title})} disabled={workspaceLocked} actions={sessionActions(s,p)}/></div>)}
                {group?.error&&<p className="sidebar-load-error" title={group.error}>{group.error}</p>}
                {!query&&matches.length>visible.length&&<button className="show-more-sessions" onClick={()=>setShownSessions(value=>({...value,[id]:(value[id]||5)+5}))}>{t('ui.showMore')}</button>}
                {!matches.length&&!group?.error&&!query&&<p className="sidebar-project-empty">{t('ui.noSessionsYet')}</p>}
              </div>}
            </section>;
          })}
          {archivedSessions&&!archiveCount&&<p className="workspace-empty">{t('ui.archiveEmpty')}</p>}
          {!!search&&!sidebarProjects.some(p=>{const id=p?.id||INBOX_ID;return (p?.name||t('ui.withoutProject')).toLowerCase().includes(search.toLowerCase())||sessionGroups.find(g=>g.projectId===id)?.sessions.some(s=>s.title.toLowerCase().includes(search.toLowerCase())&&(archivedSessions?(p?.archivedAt||s.archivedAt):!s.archivedAt));})&&<p className="workspace-empty">{t('ui.noSessionsFound')}</p>}
        </div>
        <div className="sidebar-bottom"><button className="sidebar-link" onClick={()=>setModal('knowledge')}><BookOpen size={17}/>{t('knowledge.title')}</button><button className="sidebar-link" disabled={!project} onClick={()=>reveal()}><FolderOpen size={17}/>{t('ui.projectFiles')}</button><button className="sidebar-link" disabled={!session} onClick={()=>guard(()=>api('revealWorkspace',{projectId,sessionId:session?.id}))}><FileText size={17}/>{t('ui.chatFiles')}</button><button className="sidebar-link" onClick={()=>setModal('providers')}><Settings size={17}/>{t('ui.settings')}</button></div>
      </aside>
      <main className="main" onDragEnter={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();dragDepth.current++;if(!readOnly&&!workspaceLocked&&!modal)setDragging(true);}}} onDragOver={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect=readOnly||workspaceLocked||!!modal?'none':'copy';}}} onDragLeave={event=>{if(event.dataTransfer.types.includes('Files')&&--dragDepth.current<=0){dragDepth.current=0;setDragging(false);}}} onDrop={event=>{if(!event.dataTransfer.types.includes('Files'))return;event.preventDefault();dragDepth.current=0;setDragging(false);const files=Array.from(event.dataTransfer.files);if(files.length)void importAttachments(files);}}>
        {dragging&&<div className="chat-drop-overlay" role="status"><Paperclip size={28}/><strong>{t('ui.dropFilesHere')}</strong></div>}
        <header className="chat-header"><strong className="session-title">{session?.title||t('ui.newSession')}</strong><div className="header-actions"><button data-tour="connection" className={`connection-pill ${connected?'online':''}`} onClick={()=>setModal('archicad')} title={connected?projectLabel:t('ui.connectionSettings')}><span/>{connected?`Archicad ${state?.connection.data?.archicad_version||''}`:t('ui.connectArchicad')}</button>{session&&<><IconButton title={t('ui.renameSession')} disabled={workspaceLocked} onClick={()=>setModal('rename')}><Pencil size={15}/></IconButton><IconButton title={t('ui.exportConversation')} onClick={()=>guard(()=>api('exportSession',{projectId,id:session.id}))}><Share size={16}/></IconButton><ActionMenu label={t('ui.sessionActions',{name:session.title})} disabled={workspaceLocked} actions={sessionActions(session)}/></>}</div></header>
        {readOnly&&<div className="archive-banner"><Archive size={17}/><span>{t(project?.archivedAt?'ui.projectIsArchived':'ui.sessionIsArchived')}</span><button disabled={workspaceLocked} onClick={()=>project?.archivedAt?archiveProject(project):session&&archiveSession(session)}><ArchiveRestore size={15}/>{t('ui.restore')}</button></div>}
        <div className="conversation-wrap">
        <div className="conversation" ref={conversation}>
          <div className="conversation-content" ref={conversationContent}>
          {!hasMessages?<div className="welcome">
            <Mascot/>
            <h1>{t('ui.whatShallWeDo')}</h1>
            <p className="welcome-hint">{t('ui.startSessionHint')}</p>
            <div className="suggestions">
              {suggestions().map(s=><button key={s.id} data-preset={s.id} title={s.description} onClick={()=>{setDraft(s.prompt);textInput.current?.focus();}}><Layers size={16}/><span>{s.title}</span></button>)}
            </div>
          </div>:<div className="messages">
            <VirtualMessages key={`${projectId}:${session?.id}`} ids={messageIds} scrollRef={conversation} followLatest={followLatest} render={index=>{const group=messageGroups[index];if(group){const m=group.messages[0];return group.tools?<ToolGroup key={group.id} messages={group.messages} reveal={reveal}/>:<MessageBubble key={m.id} role={m.role} text={m.text} at={m.at} onCopy={copyMessage}><AnimatedMessageContent text={m.text} animate={m.role==='assistant'&&animatedIds.current.has(m.id)} onRevealed={()=>animatedIds.current.delete(m.id)} projectId={projectId} sessionId={session?.id} onLink={openMessageLink}/>{m.usageAction&&<button className="primary" onClick={()=>guard(()=>api('external',{url:m.usageAction}))}>{t('ui.manageUsage')}<ExternalLink size={14}/></button>}</MessageBubble>;}const [id,text]=streamed[index-messageGroups.length];return <MessageBubble key={id} role="assistant" text={text} streaming onCopy={copyMessage}><AnimatedMessageContent text={text} animate projectId={projectId} sessionId={session?.id} onLink={openMessageLink}/></MessageBubble>;}}/>
            {busy&&state?.activeSession===session?.id&&!Object.keys(stream).length&&<div className="working-indicator" role="status"><Mascot size={32} working/><span>{activityLabel(session?.messages||[],!!approval)}</span></div>}
            {approval&&<div className="approval-card"><div className="approval-title"><ShieldCheck size={21}/><div><strong>{approval.kind==='python'?t('ui.runProcessing'):t('ui.confirmAction')}</strong><p>{approval.description}</p></div></div><details className="approval-details" open={approval.kind==='python'}><summary>{approval.kind==='python'?t('ui.codeToRun'):t('ui.viewExactParameters')}</summary><pre>{pretty(approval.args)}</pre></details>{approval.kind==='python'&&<p className="muted">{t('ui.theScriptRunsLocallyWithYourPermissions')}</p>}<div className="approval-actions"><button className="secondary" onClick={()=>guard(()=>api('approve',{id:approval.id,allowed:false}))}>{t('ui.cancel')}</button><button className="primary" onClick={()=>guard(()=>api('approve',{id:approval.id,allowed:true}))}><Check size={15}/>{t('ui.run')}</button></div></div>}
          </div>}
          </div>
        </div>
        {showScrollToLatest&&<button className="scroll-to-latest" title={t('ui.scrollToLatest')} aria-label={t('ui.scrollToLatest')} onClick={scrollToLatest}><ArrowDown size={19}/></button>}
        </div>
        <div className="composer-wrap">
          <WorkflowReview projectId={projectId} sessionId={session?.id} busy={busy}/>
          {!!session?.pendingMessages?.length&&<section className="message-queue" aria-label={t('ui.messageQueue')}>
            <div className="message-queue-heading"><span role="status">{session.queuePaused?t('ui.queuePaused'):t('ui.queuedMessageCount',{count:session.pendingMessages.length})}</span>{session.queuePaused&&<button className="text-button" disabled={busy||submitting} onClick={()=>guard(()=>api('resumeQueue',{projectId,sessionId:session.id}))}><Play size={13}/>{t('ui.resumeQueue')}</button>}</div>
            <ol>{session.pendingMessages.map(item=><li key={item.id}>
              <span className="queued-message-icon" aria-hidden="true">{item.delivery==='steer'?<RotateCw size={15}/>:<ArrowUpRight size={15}/>}</span>
              <div className="queued-message-copy" title={[item.text,...item.attachments].join('\n')}><span>{item.text||t('ui.attachedMaterials')}</span>{item.attachments.length>0&&<small><Paperclip size={11}/>{item.attachments.map(file=>file.split('/').pop()).join(', ')}</small>}</div>
              <button className="queued-message-steer" disabled={submitting||item.delivery==='steer'||busy&&(!state?.canSteer||session.queuePaused)} onClick={()=>changeQueued(item,'steer')}><ArrowUpRight size={13}/>{item.delivery==='steer'?t('ui.applyingCorrection'):busy?t('ui.steerTask'):t('ui.sendNow')}</button>
              <IconButton title={t('ui.editQueuedMessage')} disabled={submitting||!!draft||!!attachments.length} onClick={()=>changeQueued(item,'edit')}><Pencil size={14}/></IconButton>
              <IconButton title={t('ui.removeQueuedMessage')} disabled={submitting} onClick={()=>changeQueued(item,'remove')}><Trash2 size={14}/></IconButton>
            </li>)}</ol>
          </section>}
          {attachments.length>0&&<div className="attachments">{attachments.map(a=><span key={a}><button className="attachment-file" title={t('ui.revealFile',{path:a})} onClick={()=>reveal(a)}><Paperclip size={12}/>{a.split('/').pop()}</button><button disabled={submitting} aria-label={t('ui.removeAttachment',{name:a.split('/').pop()})} onClick={()=>setAttachments(v=>v.filter(x=>x!==a))}><X size={12}/></button></span>)}</div>}
          <div className="knowledge-chips">{selectedKnowledge.map(item=><span className="knowledge-chip" key={item.id}><BookOpen size={12}/>{item.title}<button aria-label={t('knowledge.detach')} onClick={()=>setSelectedKnowledge(current=>current.filter(selected=>selected.id!==item.id))}><X size={12}/></button></span>)}</div>
          <div data-tour="prompt" className={`composer ${busy?'is-busy':''}`}>{slash&&<KnowledgeSlash ref={slashPicker} projectId={projectId} query={slash.query} selected={selectedKnowledge} onSelect={attachSlash} onDismiss={()=>setSlashDismissed(true)} onActive={setActiveKnowledgeOption}/>}<textarea onPaste={pasteAttachments} ref={textInput} aria-label={t('ui.taskForArchiHelper')} aria-haspopup="listbox" aria-controls={slash?'knowledge-suggestions':undefined} aria-activedescendant={activeKnowledgeOption} onSelect={event=>setCursor(event.currentTarget.selectionStart)} onBlur={()=>setSlashDismissed(true)} placeholder={t(readOnly?'ui.archivedComposerHint':busy?'ui.describeFollowUp':'ui.describeYourTask')} value={draft} onChange={e=>{setDraft(e.target.value);setCursor(e.target.selectionStart);setSlashDismissed(false);}} disabled={readOnly||navigating} onKeyDown={e=>{if(slash&&slashPicker.current?.keyDown(e)){e.preventDefault();e.stopPropagation();return;}if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send((e.ctrlKey||e.metaKey)&&busy&&state?.canSteer?'steer':'queue');}}}/>
            {busy&&<div className="composer-follow-up"><span>{t(state?.canSteer?'ui.queueHint':'ui.queueHintNoSteering')}</span>{state?.canSteer&&<button disabled={submitting||(!draft.trim()&&!attachments.length)||choosing} onClick={()=>send('steer')}><ArrowUpRight size={13}/>{t('ui.steerTask')}</button>}</div>}

            <div className="composer-toolbar"><div className="composer-options"><IconButton title={t('ui.attachAPdfImageOrFile')} disabled={readOnly||workspaceLocked} onClick={()=>importAttachments('dialog')}><Paperclip size={19}/></IconButton><span data-tour="permissions" className={`permission-control ${mode==='full'?'full-access':''}`} title={`${t('ui.workMode')}: ${mode==='full'?t('ui.fullAccess'):mode==='read'?t('ui.readOnly'):t('ui.askForApproval')}${mode==='full'?' · '+t('ui.commandsFilesAndPythonWithoutConfirmation'):''}`}>{mode==='full'?<ShieldAlert size={16}/>:mode==='read'?<Eye size={16}/>:<ShieldCheck size={16}/>}<select aria-label={t('ui.workMode')} value={mode} disabled={busy} onChange={e=>{const next=e.target.value;guard(async()=>{const s=await api('settings',{permissionMode:next});setState(s);setMode(next);});}}><option value="review">{t('ui.askForApproval')}</option><option value="full">{t('ui.fullAccess')}</option><option value="read">{t('ui.readOnly')}</option></select></span></div><div className="composer-ai" data-tour="model"><select className="provider-select" title={selectedProvider?.name||t('ui.provider')} aria-label={t('ui.provider')} value={state?.providerId||''} disabled={busy||choosing||!state?.providers.length} onChange={e=>chooseSettings({providerId:e.target.value})}><option value="" disabled>{t('ui.connectAi')}</option>{state?.providers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><ModelSelect models={selectedProvider?.models} value={state?.model||''} disabled={busy||choosing||!selectedProvider} onChange={model=>chooseSettings({model})} onFocus={()=>{if(selectedDefinition?.accountCatalog&&selectedProvider&&Date.now()-(selectedProvider.catalogUpdatedAt||0)>60000&&!busy&&!choosing)guard(()=>syncModels(selectedProvider.id));}}/><IconButton title={t('ui.providerSettings')} onClick={()=>setModal('providers')}><Settings size={15}/></IconButton></div><div className="composer-reasoning" title={`${t('ui.reasoningLevel')}: ${effort?effortLabel(effort):t('ui.reasoningDefault')} · ${reasoning.toolRestricted?t('ui.reasoningToolsRestricted'):reasoning.efforts.length?t('ui.reasoningHint'):t('ui.reasoningUnavailable')}`}><Brain size={15}/><span className="effort-value" aria-hidden="true">{effort?effort.charAt(0).toUpperCase()+effort.slice(1):'—'}</span><select aria-label={t('ui.reasoningLevel')} value={effort} disabled={busy||choosing||!reasoning.efforts.length} onChange={e=>chooseSettings({reasoningEffort:e.target.value})}>{reasoning.efforts.length?reasoning.efforts.map(value=><option key={value} value={value}>{effortLabel(value)}</option>):<option value="">{t('ui.reasoningDefault')}</option>}</select></div>
            <div className="composer-actions">{busy&&<button className="send-button stop" title={t('ui.stop')} aria-label={t('ui.stop')} onClick={()=>guard(()=>api('stop',{projectId,sessionId:session?.id}))}><Square size={14} fill="currentColor"/></button>}<button className="send-button" title={t(busy||session?.pendingMessages?.length?'ui.addToQueue':'ui.sendTask')} aria-label={t(busy||session?.pendingMessages?.length?'ui.addToQueue':'ui.sendTask')} onClick={()=>send()} disabled={(!draft.trim()&&!attachments.length)||readOnly||navigating||!state?.providerId||!state?.model||choosing||submitting}><ArrowUp size={20}/></button></div></div>
          </div>
          <div className="composer-project-bar" data-tour="project">{!hasMessages&&!readOnly?<ProjectPicker projects={state?.projects||[]} project={project} disabled={workspaceLocked} onSelect={chooseDraftProject} onCreate={()=>openProjects('draft')}/>:<button className="project-context-trigger" disabled={workspaceLocked} onClick={()=>openProjects()} title={project?.path}><Folder size={16}/><span>{project?.name||t('ui.withoutProject')}</span><ChevronDown size={13}/></button>}<span className="composer-project-hint">{t('knowledge.slashComposerHint')}</span></div>
        </div>
      </main>
    </div>
    {providerPrompt&&<ProviderPrompt key={providerPrompt.id} prompt={providerPrompt}/>}
    {notice&&<div className={`toast ${notice.tone}`} role={notice.tone==='error'?'alert':'status'} aria-atomic="true">{notice.tone==='error'?<CircleAlert size={17}/>:<Check size={17}/>}<span>{notice.text}</span><IconButton title={t('ui.dismissMessage')} onClick={()=>setNotice(null)}><X size={15}/></IconButton></div>}
    {modal==='knowledge'&&<KnowledgeLibrary projectId={projectId} projectName={project?.name||t('ui.withoutProject')} selected={selectedKnowledge} onSelected={setSelectedKnowledge} onClose={()=>setModal('')}/>}
    {modal&&modal!=='knowledge'&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!working)setModal('');}}><section className={`modal ${modal==='tools'?'wide':isSettings?'settings-modal':''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="modal-header"><div><h2 id="dialog-title">{modal==='projects'?t('ui.yourProjects'):modal==='tools'?t('ui.archicadTools'):modal==='rename'?t('ui.sessionTitle'):modal==='renameProject'?t('ui.renameProject'):modal==='delete'?t('ui.confirmDeletion'):t('ui.settings')}</h2></div><IconButton title={t('ui.closeDialog')} disabled={!!working} onClick={()=>setModal('')}><X size={19}/></IconButton></div>
      {modal==='projects'&&<div className="modal-body projects-body">
        <div className="project-manager-top"><div className="workspace-tabs"><button aria-pressed={!projectArchive} onClick={()=>setProjectArchive(false)}>{t('ui.activeProjects')}</button><button aria-pressed={projectArchive} onClick={()=>setProjectArchive(true)}><Archive size={14}/>{t('ui.archive')}</button></div><label className="project-manager-search"><Search size={15}/><input aria-label={t('ui.searchProjects')} placeholder={t('ui.searchProjects')} value={projectSearch} onChange={e=>setProjectSearch(e.target.value)}/></label></div>
        {!projectArchive&&<button className="unassigned-project" disabled={workspaceLocked} onClick={()=>guard(async()=>{if(projectIntent==='draft')await chooseDraftProject(null);else await openProject(null);setModal('');})}><MessageSquare size={18}/><span>{t('ui.withoutProject')}</span>{!project&&<Check size={16}/>}</button>}
        <div className="project-manager-list">{visibleProjects.map(p=><div className="project-manager-row" key={p.id}><button className="project-open" disabled={workspaceLocked} title={p.path} onClick={()=>guard(async()=>{if(projectIntent==='draft'&&!p.archivedAt)await chooseDraftProject(p);else await openProject(p);setModal('');})}>{p.archivedAt?<Archive size={21}/>:<Folder size={21}/>}<span><strong>{p.name}</strong><small>{p.path}</small></span>{project?.id===p.id&&<Check size={16}/>}</button><ActionMenu label={t('ui.projectActions',{name:p.name})} disabled={workspaceLocked} actions={[
          {label:t('ui.renameProject'),icon:<Pencil size={15}/>,onClick:()=>{setRenamingProject(p);setModal('renameProject');}},
          {label:t(p.archivedAt?'ui.restoreProject':'ui.archiveProject'),icon:p.archivedAt?<ArchiveRestore size={15}/>:<Archive size={15}/>,onClick:()=>archiveProject(p)},
          {label:t('ui.deleteProject'),icon:<Trash2 size={15}/>,danger:true,onClick:()=>requestProjectDeletion(p)}
        ]}/></div>)}{!visibleProjects.length&&<p className="workspace-empty">{t(projectArchive?'ui.archiveEmpty':'ui.noProjectsFound')}</p>}</div>
        {!projectArchive&&<div className="project-create-form"><label>{t('ui.newProject')}<input maxLength={100} value={projectName} onChange={e=>setProjectName(e.target.value)} placeholder={t('ui.projectName')} onKeyDown={e=>{if(e.key==='Enter'&&projectName.trim()&&!workspaceLocked)createProject();}}/></label><p className="muted">{t('ui.projectFolderHint')}</p><div className="form-actions"><button className="secondary" disabled={workspaceLocked} onClick={()=>createProject(true)}><FolderOpen size={16}/>{t('ui.openFolder')}</button><button className="primary" disabled={workspaceLocked||!projectName.trim()} onClick={()=>createProject()}><Plus size={16}/>{t('ui.createProject')}</button></div></div>}
      </div>}
      {isSettings&&<div className="settings-layout">
        <nav className="settings-nav" aria-label={t('ui.settingsSections')}>
          <button aria-current={modal==='providers'?'page':undefined} onClick={()=>setModal('providers')}><Sparkles size={18}/>{t('ui.aiProviders')}</button>
          <button aria-current={modal==='preferences'?'page':undefined} onClick={()=>setModal('preferences')}><Settings size={18}/>{t('ui.applicationSettings')}</button>
          <button aria-current={modal==='archicad'?'page':undefined} onClick={()=>setModal('archicad')}><Cable size={18}/>Archicad</button>
          <button aria-current={modal==='about'?'page':undefined} onClick={()=>setModal('about')}><Info size={18}/>{t('ui.about')}</button>
        </nav>
        <div className="settings-content">
          {modal==='preferences'&&<section className="settings-page" aria-labelledby="preferences-heading">
            <div className="settings-page-header"><div><h3 id="preferences-heading">{t('ui.applicationSettings')}</h3><p>{t('ui.chatAppearance')}</p></div></div>
            <div className="settings-card chat-preference"><div><h4 id="tool-details-label">{t('ui.showToolDetails')}</h4><p id="tool-details-hint" className="settings-description">{t('ui.showToolDetailsHint')}</p></div><button className="settings-switch" role="switch" aria-checked={state.showToolDetails===true} aria-labelledby="tool-details-label" aria-describedby="tool-details-hint" disabled={!!working} onClick={()=>guard(async()=>{const next=await api('chatPreferences',{showToolDetails:!state.showToolDetails});setState(current=>current?{...current,...next}:current);},t('ui.saving'))}><span/></button></div>
            <TelemetrySettings value={state.telemetry} onChange={telemetry=>setState(current=>current?{...current,telemetry}:current)}/>
          </section>}
          {modal==='providers'&&<section className="settings-page" aria-labelledby="providers-heading">
            <div className="settings-page-header"><div><h3 id="providers-heading">{t('ui.aiProviders')}</h3><p>{t('ui.providerSectionDescription')}</p></div><button className="secondary" disabled={busy||!!working} onClick={()=>editProvider()}><Plus size={16}/>{t('ui.addProvider')}</button></div>
            {!state.providers.length&&<p className="settings-description">{t('ui.providerWelcome')}</p>}<div className="settings-card"><h4>{t('ui.oauthSignIn')}</h4><p className="settings-description">{t('ui.oauthSignInDescription')}</p><div className="oauth-options">{providerDefinitions.filter(def=>def.oauth).map(def=>{const existing=state.providers.find(p=>p.definitionId===def.id&&p.oauth);return <OAuthConnect key={def.id} definition={def} providerId={existing?.id} onState={setState} disabled={busy||!!working||existing?.oauth?.status==='revoking'} onBusy={value=>setWorking(value?t('ui.oauthWaiting'):'')} onConnected={oauthConnected}/>;})}</div></div>
            {!!state?.providers.length&&<div className="settings-provider-list">{state.providers.map(p=><div className={`provider-row ${state.providerId===p.id?'active':''}`} key={p.id}>
              <button className="provider-select-row" disabled={busy||choosing||!!working} onClick={()=>chooseSettings({providerId:p.id})}><span className="provider-meta"><span className="provider-name-line"><strong>{p.name}{p.oauth&&` · ${maskAccount(p.oauth.accountName)}`}</strong>{state.providerId===p.id&&<span className="settings-badge">{t('ui.selectedInChat')}</span>}</span><small title={p.baseURL}>{p.baseURL} · {t('ui.modelCount',{count:p.models.length})}</small></span></button>
              <div className="provider-actions"><IconButton title={t('ui.editProvider')} disabled={busy||!!working} onClick={()=>editProvider(p)}><Pencil size={15}/></IconButton><IconButton title={t('ui.refreshModels')} disabled={busy||!!working||choosing||!!p.oauth&&p.oauth.status!=='connected'} onClick={()=>guard(()=>syncModels(p.id),t('ui.fetchingModels'))}><RotateCw size={15}/></IconButton><IconButton title={t(p.oauth?'ui.oauthDisconnect':'ui.deleteProvider')} disabled={busy||!!working||choosing} onClick={()=>guard(async()=>{try{const next=await api('deleteProvider',{id:p.id});setState(next);if(providerForm.id===p.id&&!next.providers.some((item:Provider)=>item.id===p.id))setProviderForm(next.providers.length?providerToForm(next.providers[0]):emptyProvider());}catch(error){setState(await api('bootstrap'));throw error;}},t('ui.providerRemoving'))}><X size={16}/></IconButton></div>
            </div>)}</div>}
            <div className="settings-card settings-editor" ref={providerEditor}>
              <div className="settings-card-heading"><h4>{providerForm.id?t('ui.providerConnection',{name:providerForm.name}):t('ui.addProvider')}</h4><p>{providerForm.id?t('ui.editingConnection'):t('ui.newConnection')}</p></div>
              {!providerForm.id&&<div className="settings-presets">{[...providerDefinitions.filter(def=>!def.oauth?.dynamicRegistration).map(def=>[def.name,def.baseURL]),[t('ui.localModel'),'http://localhost:1234/v1'],[t('ui.otherProvider'),'https://']].map(([name,baseURL])=><button key={baseURL} disabled={busy||!!working} onClick={()=>setProviderForm({...emptyProvider(),name,baseURL})}>{name}</button>)}</div>}
              {providerForm.oauth&&<div className="settings-description"><p>{t('ui.oauthAccount',{name:maskAccount(providerForm.oauth.accountName)})} · {t(providerForm.oauth.status==='signed-out'?'ui.oauthSignedOut':providerForm.oauth.planEnabled===false?'ui.oauthPlanDisabled':providerForm.oauth.status==='connected'?'ui.oauthConnected':'ui.oauthNeedsAttention')}</p>{providerDefinitions.filter(def=>def.id===providerForm.definitionId).map(def=><OAuthConnect key={def.id} definition={def} providerId={providerForm.id} disabled={busy||!!working} onBusy={value=>setWorking(value?t('ui.oauthWaiting'):'')} onState={setState} onConnected={oauthConnected}/>)}</div>}
              {providerForm.oauth&&editorDefinition?.manageUsageURL&&<div className="plan-usage provider-plan"><span>{t(providerForm.oauth.status==='connected'&&providerForm.oauth.planEnabled?editorDefinition.planLabel!:'ui.oauthNeedsAttention')}</span><button className="secondary" onClick={()=>guard(()=>api('external',{url:editorDefinition.manageUsageURL}))}>{t('ui.manageUsage')}<ExternalLink size={14}/></button></div>}
              <div className="settings-form">
                <div className="settings-fields"><label className="settings-field"><span>{t('ui.name')}</span><input value={providerForm.name} onChange={e=>setProviderForm(v=>({...v,name:e.target.value}))}/></label><label className="settings-field"><span>{t('ui.apiAddress')}</span><input disabled={!!providerForm.oauth} value={providerForm.baseURL} onChange={e=>setProviderForm(v=>({...v,baseURL:e.target.value}))} placeholder="https://api.example.com/v1"/></label></div>
                {!providerForm.oauth&&<label className="settings-field"><span>{t('ui.apiKey')}</span><input type="password" autoComplete="off" value={providerForm.apiKey} onChange={e=>setProviderForm(v=>({...v,apiKey:e.target.value}))} placeholder={providerForm.id?t('ui.leaveBlankToKeepTheKey'):t('ui.pasteYourProviderKey')}/></label>}
                <label className="settings-checkbox"><input type="checkbox" checked={providerForm.supportsImages} onChange={e=>setProviderForm(v=>({...v,supportsImages:e.target.checked}))}/>{t('ui.theApiAndModelSupportImages')}</label>
                {!editorDefinition?.accountCatalog&&<div className="settings-advanced-list">
                  <details className="settings-advanced"><summary>{t('ui.reasoningCompatibility')}<ChevronRight size={16}/></summary><div className="settings-advanced-content"><p>{t('ui.reasoningCompatibilityHint')}</p><label className="settings-field"><span>{t('ui.reasoningFormat')}</span><select value={providerForm.reasoningFormat} onChange={e=>setProviderForm(v=>({...v,reasoningFormat:e.target.value}))}><option value="auto">{t('ui.automatic')}</option><option value="effort">OpenAI / reasoning_effort</option><option value="openrouter">OpenRouter / reasoning.effort</option><option value="deepseek">DeepSeek / thinking</option><option value="none">{t('ui.reasoningUnsupported')}</option></select></label><label className="settings-field"><span>{t('ui.reasoningEfforts')}</span><input value={providerForm.reasoningEfforts} onChange={e=>setProviderForm(v=>({...v,reasoningEfforts:e.target.value}))} placeholder="low, medium, high, xhigh"/></label></div></details>
                  <details className="settings-advanced"><summary>{t('ui.modelById')}<ChevronRight size={16}/></summary><div className="settings-advanced-content"><div className="settings-control-row"><label className="settings-field"><span>{t('ui.modelId')}</span><input placeholder="model-id" value={manualModel} onChange={e=>setManualModel(e.target.value)}/></label><button className="secondary" disabled={!manualModel.trim()||!providerForm.id||busy||choosing||!!working} onClick={()=>guard(async()=>{await api('settings',{providerId:providerForm.id,model:manualModel.trim()});await refresh();setModal('');})}>{t('ui.select')}</button></div></div></details>
                </div>}
                <div className="settings-actions"><button className="primary" disabled={!!working||busy||choosing||!!providerForm.oauth&&providerForm.oauth.status!=='connected'} onClick={()=>guard(async()=>{const next=await api('saveProvider',{...providerForm,reasoningEfforts:providerForm.reasoningEfforts.split(',').map(v=>v.trim()).filter(Boolean)});setState(next);const saved=next.providers.find((p:Provider)=>p.id===providerForm.id)||next.providers.at(-1);setProviderForm(providerToForm(saved));if(saved.oauth?.planEnabled!==false)await syncModels(saved.id);notify(t('ui.providerConnected'));},t('ui.checkingApi'))}>{working||t('ui.saveAndCheck')}</button></div>
              </div>
            </div>
          </section>}
          {modal==='archicad'&&<section className="settings-page" aria-labelledby="archicad-heading">
            <div className="settings-page-header"><div><h3 id="archicad-heading">Archicad</h3><p>{t('ui.archicadSectionDescription')}</p></div></div>
            <div className={`settings-card settings-connection ${connected?'online':''}`}>
              <div className="settings-connection-status"><span className="connection-dot"/><div><h4>{connected?t('ui.archicadConnected',{value0:state?.connection.data?.archicad_version||''}):t('ui.openAProjectInArchicad')}</h4><p className="connection-description">{connected?projectLabel:state?.connection.message}</p>{connected&&<p className="connection-meta">{tapirVersion&&`Tapir ${tapirVersion} · `}{t('ui.toolCount',{count:state?.toolCount||0})}</p>}</div></div>
              <div className="settings-connection-actions"><button className="primary" onClick={connect} disabled={busy||!!working}><RotateCw size={16} className={working===t('ui.connecting')?'spin':undefined}/>{working===t('ui.connecting')?t('ui.connectingAlt'):connected?t('ui.reconnect'):t('ui.connect')}</button><button className="secondary" disabled={!!working} onClick={()=>guard(()=>api('launchArchicad'))}><FolderOpen size={16}/>{t('ui.openPln')}</button></div>
            </div>
            <TapirSettings connection={state?.connection} disabled={!!working||busy} active={tapirActive} onInstall={()=>guard(async()=>{setTapirProgress(null);const result=await api('installTapir');notify(result.message);},t('ui.downloadingTapir'))}>
              {tapirProgress&&<TapirProgress progress={tapirProgress}/>}
            </TapirSettings>
            <div className="settings-card settings-card-list">
              <details className="settings-advanced"><summary>{t('ui.chooseArchicadInstance')}<span>{state?.archicadPort||t('ui.automatic')}</span><ChevronRight size={16}/></summary><div className="settings-advanced-content"><div className="settings-control-row"><label className="settings-field"><span>{t('ui.port')}</span><select value={port} onChange={e=>setPort(e.target.value)}><option value="">{t('ui.automatic')}</option>{Array.from({length:21},(_,i)=>String(19723+i)).map(p=><option key={p} value={p}>{p}{instances.some(x=>String(x.port)===p)?t('ui.open'):''}</option>)}</select></label><button className="secondary" disabled={!!working||busy} onClick={()=>guard(async()=>{const found=await api('scan');setInstances(found);notify(found.length?t('ui.found',{value0:found.length}):t('ui.noRunningArchicadFound'));},t('ui.findingArchicad'))}>{t('ui.findRunningInstances')}</button><button className="primary" disabled={busy||!!working} onClick={()=>guard(async()=>{await api('settings',{archicadPort:port});await connect();})}>{t('ui.apply')}</button></div></div></details>
              <button className="settings-tools-link" onClick={openTools}><Wrench size={18}/><span>{t('ui.archicadTools')}</span><span className="settings-badge neutral">{state?.toolCount||0}</span><ChevronRight size={17}/></button>
            </div>
          </section>}
          {modal==='about'&&<section className="settings-page settings-about" aria-labelledby="about-heading">
            <div className="settings-page-header"><div><h3 id="about-heading">{t('ui.about')}</h3><p>{t('ui.aboutSectionDescription')}</p></div></div>
            <div className="settings-card settings-app-identity"><img src="./helmet.png" alt={t('ui.yellowHardHat')} width="48" height="48"/><div><h4>Archi Helper</h4><p>{t('ui.architectSAssistant')}</p></div><span className="settings-version">v{state?.appVersion||update?.version||'—'}</span></div>
            <div className={`settings-card settings-update ${updateStatus==='error'?'has-error':''}`}><span className="settings-update-icon"><RotateCw size={23} className={['checking','downloading'].includes(updateStatus)?'spin':undefined}/></span><div className="settings-update-copy"><h4>{t('ui.updates')}</h4><p role="status">{updateDescription}</p></div>{updateStatus==='disabled'?<button className="secondary" onClick={()=>guard(()=>api('external',{url:'https://github.com/streletskiy/archi-helper/releases'}))}><ExternalLink size={15}/>{t('ui.openReleases')}</button>:<button className="secondary" disabled={!!working||['checking','downloading','ready','countdown','installing'].includes(updateStatus)} onClick={()=>guard(async()=>setUpdate(await api('checkUpdates')))}>{t('ui.checkForUpdates')}</button>}</div>
            <section className="settings-info-section"><h4>{t('ui.bundledComponents')}</h4><div className="settings-components">{[`Python${state?.runtimeInfo?.pythonVersion?' '+state.runtimeInfo.pythonVersion:''}`,'uv','MCP'].map(name=><span key={name}><Check size={14}/>{name}</span>)}</div></section>
            <div className="settings-card tour-replay"><div><h4>{t('ui.tourReplayTitle')}</h4><p className="settings-description">{t('ui.tourReplayHint')}</p></div><button className="secondary" disabled={workspaceLocked} onClick={()=>{onboardingOffered.current=true;setModal('');setOnboarding('manual');}}><Play size={15}/>{t('ui.tourReplay')}</button></div>
            <footer className="settings-links"><button onClick={()=>guard(()=>api('external',{url:'https://github.com/streletskiy/archi-helper'}))}><ExternalLink size={14}/>{t('ui.projectOnGithub')}</button><button onClick={()=>guard(()=>api('external',{url:'https://github.com/ENZYME-APD/tapir-archicad-automation'}))}><ExternalLink size={14}/>Tapir Archicad Automation</button></footer>
          </section>}
        </div>
      </div>}
      {modal==='tools'&&<div className="tool-browser"><div className="tool-browser-list"><div className="sidebar-search"><Search size={15}/><input aria-label={t('ui.findTool')} placeholder={t('ui.nameOrDescription')} value={toolSearch} onChange={e=>setToolSearch(e.target.value)}/></div><small>{t('ui.toolCount',{count:filteredTools.length})}</small><div>{filteredTools.map(t=><button key={t.key} className={selectedTool?.key===t.key?'selected':''} onClick={()=>chooseTool(t)}><span>{t.readOnly?<Search size={13}/>:<Wrench size={13}/>}</span>{t.name}</button>)}</div></div><div className="tool-browser-detail">{selectedTool?<><div className="tool-name"><h3>{selectedTool.name}</h3><span className={`tag ${selectedTool.readOnly?'green':''}`}>{selectedTool.readOnly?t('ui.read'):t('ui.modify')}</span></div><p className="muted">{selectedTool.description}</p><details><summary>{t('ui.parameterSchema')}</summary><pre>{pretty(selectedTool.inputSchema)}</pre></details><label>{t('ui.jsonParameters')}<textarea className="code-input" value={toolArgs} onChange={e=>setToolArgs(e.target.value)} rows={9}/></label><button className="primary" disabled={!session||busy||readOnly} onClick={()=>guard(async()=>{const args=JSON.parse(toolArgs);setModal('');await api('directTool',{projectId,sessionId:session?.id,key:selectedTool.key,args,mode});})}><Play size={15}/>{t('ui.run')}</button></>:<div className="tool-placeholder"><Wrench size={30}/><p>{t('ui.chooseAToolOnTheLeft')}</p></div>}</div></div>}
      {modal==='rename'&&<Rename title={session?.title||''} onSave={title=>guard(async()=>{await api('renameSession',{projectId,id:session?.id,title});setSession(s=>s?{...s,title}:s);await refreshSessions();setModal('');})}/>}
      {modal==='renameProject'&&renamingProject&&<Rename title={renamingProject.name} onSave={name=>guard(async()=>{const next=await api('renameProject',{id:renamingProject.id,name});setState(next);if(project?.id===renamingProject.id){const p=next.projects.find((p:Project)=>p.id===renamingProject.id);projectRef.current=p;setProject(p);}setModal('');})}/>}
      {modal==='delete'&&deletion&&<div className="modal-body delete-confirm"><div className="delete-symbol"><Trash2 size={24}/></div><h3>{t(deletion.kind==='project'?'ui.deleteProjectQuestion':'ui.deleteSessionQuestion',{name:deletion.name})}</h3><p>{t(deletion.kind==='project'?'ui.deleteProjectDescription':'ui.deleteSessionDescription',{count:deletion.count??'—'})}</p><div className="form-actions"><button className="secondary" disabled={!!working} onClick={()=>setModal('')}>{t('ui.cancel')}</button><button className="danger-button" disabled={!!working||busy} onClick={deleteItem}><Trash2 size={16}/>{working||t('ui.deletePermanently')}</button></div></div>}
    </section></div>}
    {onboarding&&state&&!modal&&!busy&&!approval&&!providerPrompt&&<Onboarding connection={state.connection||{}} focusOnOpen={onboarding==='manual'} onOpenConnection={()=>setModal('archicad')} onFinish={finishOnboarding}/>}
  </div>;
}
function groupMessages(messages:Message[]){
  const groups:{id:string;tools:boolean;messages:Message[]}[]=[];
  for(const message of messages){const previous=groups.at(-1);if(message.role==='tool'&&previous?.tools)previous.messages.push(message);else groups.push({id:message.id,tools:message.role==='tool',messages:[message]});}
  return groups;
}
function ToolGroup({messages,reveal}:{messages:Message[];reveal:(relative?:string)=>unknown}){
  const [expanded,setExpanded]=useState(false);
  const active=messages.find(m=>m.status==='running'),running=!!active,errors=messages.filter(m=>m.status==='error').length;
  const title=(m:Message)=>{const args=m.args as {purpose?:string;name?:string;path?:string}|undefined;return [args?.purpose,args?.name,args?.path,labels()[m.name||''],m.name].find(value=>typeof value==='string'&&value.trim());};
  const milestones=messages.filter(m=>m.summary);
  return <div className="tool-activity">
    {milestones.length>0&&<ul className="tool-progress" aria-label={t('ui.taskProgress')} aria-live="polite" aria-relevant="additions text">{milestones.map(m=><li key={m.id} className={m.status==='error'?'has-error':''}>{m.status==='error'?<CircleAlert size={14}/>:<Check size={14}/>}<span>{m.summary}</span></li>)}</ul>}
    <details onToggle={event=>setExpanded(event.currentTarget.open)} className={`tool-group ${running?'is-running':''} ${errors?'has-errors':''}`}><summary>{running?<RotateCw className="spin" size={14}/>:<Wrench size={14}/>}<strong>{active?title(active):t('ui.toolGroup',{count:messages.length})}</strong><span>{running?t('ui.running'):errors?t('ui.toolGroupErrors',{count:errors}):t('ui.toolGroupDone')}</span><ChevronDown size={14}/></summary>{expanded&&<div className="tool-group-content">{messages.map(m=><details key={m.id} className={`tool-message ${m.status}`}><summary><span className="tool-state">{m.status==='running'?<RotateCw className="spin" size={14}/>:m.status==='error'?<X size={14}/>:<Check size={14}/>}</span><strong>{title(m)}</strong><span>{m.status==='running'?t('ui.running'):m.artifact?bytes(m.artifact.bytes):''}</span><ChevronDown size={13}/></summary><div className="tool-detail">{m.args!==undefined&&<><label>{t('ui.parameters')}</label><pre>{pretty(m.args)}</pre></>}<label>{t('ui.result')}</label><pre>{m.text}</pre>{m.artifact&&<button className="text-button" onClick={()=>reveal(m.artifact?.path)}><FileText size={14}/>{t('ui.fullResult')}{' '}{bytes(m.artifact.bytes)}<ArrowUpRight size={13}/></button>}</div></details>)}</div>}</details>
  </div>;
}
function Rename({title,onSave}:{title:string;onSave:(s:string)=>void}){const [value,setValue]=useState(title);return <div className="modal-body"><label>{t('ui.name')}<input autoFocus maxLength={100} value={value} onChange={e=>setValue(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&value.trim())onSave(value.trim());}}/></label><div className="form-actions"><button className="primary" disabled={!value.trim()} onClick={()=>onSave(value.trim())}>{t('ui.save')}</button></div></div>;}
function TapirProgress({progress}:{progress:TapirDownloadProgress}) {
  const {status,percent,total,transferred,bytesPerSecond,message,version}=progress;
  const active=['checking','downloading','verifying','installing'].includes(status),indeterminate=status==='checking'||status==='downloading'&&total<=0;
  const text=t(({checking:'ui.tapirCheckingRelease',downloading:'ui.downloadingTapir',verifying:'ui.tapirVerifying',installing:'ui.tapirInstalling',launched:'ui.tapirInstallerLaunched',error:'ui.tapirDownloadFailed'} as const)[status]);
  return <div className={`tapir-progress ${status==='error'?'has-error':''}`} aria-busy={active}>
    <div className="tapir-progress-heading"><span role="status">{text}</span><span>{status==='downloading'&&total>0?`${percent}%`:version?`Tapir ${version}`:''}</span></div>
    {status!=='error'&&<div className={`update-progress ${indeterminate?'is-indeterminate':''}`} role="progressbar" aria-label={text} aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate?undefined:percent}><span style={{width:indeterminate?'30%':`${percent}%`}}/></div>}
    {status==='downloading'&&<div className="update-transfer"><span>{total>0?t('ui.updateTransfer',{transferred:bytes(transferred),total:bytes(total)}):bytes(transferred)}</span>{bytesPerSecond>0&&<span>{t('ui.updateSpeed',{speed:bytes(bytesPerSecond)})}</span>}</div>}
    {message&&<p className="tapir-progress-message">{message}</p>}
  </div>;
}
function UpdateNotice({update,updateOnly,onLater,onRetry,onRestart}:{update:any;updateOnly:boolean;onLater:()=>void;onRetry:()=>void;onRestart:()=>void}){
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(update?.status!=='countdown')return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[update?.status,update?.restartAt]);
  const status=update.status,percent=Math.max(0,Math.min(100,Math.round(update.percent||0)));
  const spinning=['checking','downloading','installing'].includes(status),indeterminate=['checking','installing'].includes(status);
  const text=status==='checking'?t('ui.checkingUpdates'):status==='downloading'?t('ui.downloadingUpdate',{value0:percent}):status==='countdown'?t('ui.updateReadyRestartingInS',{value0:Math.max(0,Math.ceil((update.restartAt-now)/1000))}):status==='installing'?t(update.stage==='preparing'?'ui.updatePreparingTitle':update.stage==='restarting'?'ui.updateRestartingTitle':update.stage==='reopening'?'ui.reopenApplication':'ui.installingUpdate'):status==='error'?t('ui.updateFailed'):status==='current'?t('ui.youHaveTheLatestVersion'):update.deferred?t('ui.willUpdateOnNextLaunch'):t('ui.updateReadyWaitingForWorkToFinish');
  const description=status==='checking'?t('ui.updateCheckingDescription'):status==='downloading'?t('ui.updateDownloadDescription'):status==='installing'?t(update.stage==='preparing'?'ui.updatePreparingDescription':update.stage==='restarting'?'ui.updateRestartingDescription':update.stage==='reopening'?'ui.updateReopeningDescription':'ui.updateInstallDescription'):status==='error'?t(updateOnly?'ui.updateInstallFailedDescription':'ui.updateRetryDescription'):status==='countdown'?t('ui.updateRestartDescription'):status==='ready'?t(update.deferred?'ui.updateDeferredDescription':'ui.updateWaitingDescription'):'';
  const step=status==='checking'?0:status==='downloading'?1:update.stage==='restarting'?3:2;
  const steps=[t('ui.updateCheckStage'),t('ui.updateDownloadStage'),t('ui.updateInstallStage'),t('ui.updateLaunchStage')];
  return <div className="update-screen"><section className={`update-notice ${status==='error'?'has-error':''}`} aria-label={t('ui.updates')}>
    <div className="update-screen-brand"><img src="./helmet.png" alt="" width="144" height="144"/><span>Archi Helper</span></div>
    <div className="update-notice-heading"><span className="update-notice-icon" aria-hidden="true">{spinning?<RotateCw size={25} className="spin"/>:status==='error'?<CircleAlert size={25}/>:<Check size={25}/>}</span><div className="update-notice-copy" role="status"><strong>{text}</strong>{(update.nextVersion||update.version)&&<span>v{update.nextVersion||update.version}</span>}</div></div>
    {!['error','current'].includes(status)&&<><ol className="update-steps">{steps.map((label,index)=><li key={label} className={index<step?'done':index===step?'active':''} aria-current={index===step?'step':undefined}><span aria-hidden="true">{index<step?<Check size={12}/>:index===step&&spinning?<RotateCw size={12} className="spin"/>:<Circle size={12}/>}</span>{label}</li>)}</ol><div className={`update-progress ${indeterminate?'is-indeterminate':''}`} role="progressbar" aria-label={text} aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate?undefined:status==='downloading'?percent:100}><span style={{width:indeterminate?'30%':`${status==='downloading'?percent:100}%`}}/></div></>}
    {status==='downloading'&&<div className="update-transfer"><span>{update.total>0?t('ui.updateTransfer',{transferred:bytes(update.transferred||0),total:bytes(update.total)}):`${percent}%`}</span>{update.bytesPerSecond>0&&<span>{t('ui.updateSpeed',{speed:bytes(update.bytesPerSecond)})}</span>}</div>}
    {description&&<p className="update-notice-description">{description}</p>}
    {(['ready','countdown'].includes(status)&&!update.deferred||status==='error')&&<div className="update-notice-actions">{status==='countdown'&&<button className="primary" onClick={onRestart}><RotateCw size={15}/>{t('ui.restartNow')}</button>}{status==='error'&&!updateOnly&&<button className="text-button" onClick={onLater}>{t('ui.continueWithoutUpdate')}</button>}<button className="secondary" onClick={status==='error'?onRetry:onLater}>{status==='error'?t(updateOnly?'ui.reopenApplication':'ui.checkForUpdates'):t('ui.later')}</button></div>}
  </section></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);

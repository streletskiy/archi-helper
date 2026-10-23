import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft,ArrowRight,Check} from 'lucide-react';
import {t,useLanguage} from './i18n';
import {clamp,placeCard,type TourRect,type TourSize,type TourPlacement} from './tour-geometry';
import './onboarding.css';

type Connection={connected?:boolean;data?:{tapir_installed?:boolean|string|null}};
type Props={connection:Connection;focusOnOpen?:boolean;onOpenConnection:()=>void;onFinish:()=>void};
const steps=[
  {id:'prompt',target:'[data-tour="prompt"]',placement:'top',title:'ui.tourPromptTitle',body:'ui.tourPromptBody'},
  {id:'connection',target:'[data-tour="connection"]',placement:'bottom',title:'ui.tourConnectionTitle',body:'ui.tourConnectionBody'},
  {id:'model',target:'[data-tour="model"]',placement:'top',title:'ui.tourModelTitle',body:'ui.tourModelBody'},
  {id:'permissions',target:'[data-tour="permissions"]',placement:'top',title:'ui.tourPermissionsTitle',body:'ui.tourPermissionsBody'},
  {id:'project',target:'[data-tour="project"] .project-context-trigger',placement:'top',title:'ui.tourProjectTitle',body:'ui.tourProjectBody'}
] as const;
type Layout={target:TourRect;position:ReturnType<typeof placeCard>;viewport:TourSize};

function visibleTarget(selector:string){
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(element=>{
    const box=element.getBoundingClientRect(),style=getComputedStyle(element);
    return !element.closest('[inert], [aria-hidden="true"]')&&box.width>0&&box.height>0&&style.visibility!=='hidden'&&style.display!=='none';
  });
}

/** A non-modal tour, following lumv's spotlight/card pattern. The workspace stays interactive. */
export function Onboarding({connection,focusOnOpen=false,onOpenConnection,onFinish}:Props){
  const language=useLanguage(),[index,setIndex]=useState(0),[layout,setLayout]=useState<Layout|null>(null);
  const card=useRef<HTMLDivElement|null>(null),measure=useRef(()=>{}),finished=useRef(false),focusRequested=useRef(focusOnOpen);
  const returnFocus=useRef(document.activeElement as HTMLElement|null),finish=useRef(onFinish);
  finish.current=onFinish;
  const [available]=useState(()=>steps.filter(step=>visibleTarget(step.target)));
  const step=available[index];
  const close=useCallback((restoreFocus=false)=>{
    if(finished.current)return;finished.current=true;
    if(restoreFocus&&card.current?.contains(document.activeElement)){
      const previous=returnFocus.current,target=previous?.isConnected?previous:document.querySelector<HTMLElement>('.composer textarea');
      requestAnimationFrame(()=>target?.focus({preventScroll:true}));
    }
    finish.current();
  },[]);
  const move=(direction:number)=>{
    if(direction>0&&index===available.length-1)return close(true);
    focusRequested.current=true;setIndex(current=>clamp(current+direction,0,available.length-1));
  };
  useLayoutEffect(()=>{
    if(!step){close();return;}
    let frame=0;
    const update=()=>{
      frame=0;const element=visibleTarget(step.target);
      if(!element){close();return;}
      const box=element.getBoundingClientRect(),viewport={width:document.documentElement.clientWidth,height:window.innerHeight};
      const x=clamp(box.left-6,8,viewport.width-8),y=clamp(box.top-6,51,viewport.height-8);
      const target={x,y,width:Math.min(box.right+6,viewport.width-8)-x,height:Math.min(box.bottom+6,viewport.height-8)-y};
      if(target.width<=0||target.height<=0){close();return;}
      const size={width:card.current?.offsetWidth||320,height:card.current?.offsetHeight||210};
      const position=placeCard({...target,y:target.y-43},size,{...viewport,height:viewport.height-43},step.placement);
      position.y+=43;
      setLayout(current=>{
        const next={target,position,viewport};return JSON.stringify(current)===JSON.stringify(next)?current:next;
      });
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
    measure.current=update;update();
    const observer=new ResizeObserver(schedule),element=visibleTarget(step.target);
    if(element)observer.observe(element);observer.observe(document.documentElement);
    window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,{capture:true,passive:true});
    return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);measure.current=()=>{};};
  },[step,language,close]);
  const attach=useCallback((node:HTMLDivElement|null)=>{
    card.current=node;if(!node)return;
    const observer=new ResizeObserver(()=>measure.current()),frame=requestAnimationFrame(()=>measure.current());observer.observe(node);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();if(card.current===node)card.current=null;};
  },[]);
  useEffect(()=>{
    if(layout&&focusRequested.current){focusRequested.current=false;card.current?.querySelector<HTMLElement>('[data-tour-primary]')?.focus({preventScroll:true});}
  },[index,layout]);
  useEffect(()=>{
    const outside=(event:Event)=>{if(event.target instanceof Node&&!card.current?.contains(event.target))close();};
    const keyboard=(event:KeyboardEvent)=>{
      if(event.isComposing)return;
      if(event.key==='Escape'){event.preventDefault();close(true);}
      else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='n')close();
    };
    document.addEventListener('pointerdown',outside,true);document.addEventListener('input',outside,true);window.addEventListener('keydown',keyboard,true);
    return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('input',outside,true);window.removeEventListener('keydown',keyboard,true);};
  },[close]);
  if(!step||!layout)return null;
  const body=step.id==='connection'?t(connection.connected?connection.data?.tapir_installed?'ui.tourConnectionReady':'ui.tourConnectionTapir':'ui.tourConnectionBody'):t(step.body);
  const {target,position,viewport}=layout;
  return createPortal(<div className="onboarding-tour" data-tour-overlay>
    <svg className="tour-spotlight" width={viewport.width} height={viewport.height} aria-hidden="true"><defs><mask id="archi-tour-cutout" maskUnits="userSpaceOnUse" x="0" y="0" width={viewport.width} height={viewport.height}><rect width={viewport.width} height={viewport.height} fill="white"/><rect className="tour-hole" x={target.x} y={target.y} width={target.width} height={target.height} rx="12" fill="black"/></mask></defs><rect width={viewport.width} height={viewport.height} fill="rgb(35 53 40 / .16)" mask="url(#archi-tour-cutout)"/><rect className="tour-outline" x={target.x} y={target.y} width={target.width} height={target.height} rx="12"/></svg>
    <div className="tour-position" style={{transform:`translate3d(${position.x}px,${position.y}px,0)`}}>
      <div key={step.id} className="tour-card" data-tour-id={step.id} data-placement={position.placement} ref={attach} role="dialog" aria-labelledby="tour-title" aria-describedby="tour-description">
        <span className="tour-arrow" aria-hidden="true" style={arrowStyle(position.placement,position.arrow)}/>
        <div className="tour-heading"><span className="tour-count">{index+1} / {available.length}</span><button className="tour-skip" aria-label={t('ui.tourSkipLabel')} onClick={()=>close(true)}>{t('ui.tourSkip')}</button></div>
        <h2 id="tour-title">{t(step.title)}</h2><p id="tour-description">{body}</p>
        {step.id==='connection'&&<button className="tour-settings" onClick={()=>{close();onOpenConnection();}}>{t('ui.tourOpenConnection')}<ArrowRight size={12}/></button>}
        <footer className="tour-actions"><div className="tour-dots" aria-hidden="true">{available.map((item,dot)=><i key={item.id} className={dot===index?'active':dot<index?'seen':''}/>)}</div><div>{index>0&&<button className="tour-back" aria-label={t('ui.tourBack')} title={t('ui.tourBack')} onClick={()=>move(-1)}><ArrowLeft size={15}/></button>}<button className="tour-next" data-tour-primary onClick={()=>move(1)}>{t(index===available.length-1?'ui.tourDone':'ui.tourNext')}{index===available.length-1?<Check size={14}/>:<ArrowRight size={14}/>}</button></div></footer>
      </div>
    </div>
    <span className="tour-announcement" aria-live="polite" aria-atomic="true">{t('ui.tourAnnouncement',{current:index+1,total:available.length,title:t(step.title)})}</span>
  </div>,document.body);
}

function arrowStyle(placement:TourPlacement,offset:number){
  if(placement==='top')return {bottom:-5,left:offset-5};
  if(placement==='bottom')return {top:-5,left:offset-5};
  if(placement==='left')return {right:-5,top:offset-5};
  return {left:-5,top:offset-5};
}

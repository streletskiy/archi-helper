import {useLayoutEffect,useRef,useState,type ComponentProps} from 'react';
import {MessageContent} from './MessageContent';

export function AnimatedMessageContent({animate=false,text,onRevealed,...props}:ComponentProps<typeof MessageContent>&{animate?:boolean;onRevealed?:()=>void}) {
  const revealed=useRef(onRevealed);revealed.current=onRevealed;
  const complete=!!onRevealed;
  const [length,setLength]=useState(animate?0:text.length),shown=useRef(animate?0:text.length),previous=useRef(text);
  useLayoutEffect(()=>{
    const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame=0,last=performance.now();
    if(!text.startsWith(previous.current))shown.current=0;
    previous.current=text;
    const finish=()=>{cancelAnimationFrame(frame);shown.current=text.length;setLength(text.length);revealed.current?.();};
    const step=(now:number)=>{
      const remaining=text.length-shown.current,elapsed=Math.min(64,Math.max(1,now-last));last=now;
      let end=Math.min(text.length,shown.current+Math.ceil(Math.max(1.5,remaining/100)*elapsed));
      if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end++;
      shown.current=end;setLength(end);
      if(end<text.length)frame=requestAnimationFrame(step);else revealed.current?.();
    };
    const change=()=>{if(motion.matches)finish();};
    if(!animate||motion.matches)finish();else frame=requestAnimationFrame(step);
    motion.addEventListener('change',change);
    return()=>{cancelAnimationFrame(frame);motion.removeEventListener('change',change);};
  },[text,animate,complete]);
  return <MessageContent {...props} text={animate?text.slice(0,length):text}/>;
}

import {useEffect,useState,type CSSProperties} from 'react';
import sheet from './mascot-animations.json';

export type MascotAnimation=keyof typeof sheet.animations;
const repertoire:MascotAnimation[]=['idle','wave','idle','idea','reading','measure','idle','inspect','build','celebrate'];
export function Mascot({size=128,working=false,animation}:{size?:number;working?:boolean;animation?:MascotAnimation}){
  const [beat,setBeat]=useState(0);
  useEffect(()=>{if(animation||working)return;const timer=setInterval(()=>setBeat(value=>(value+1)%repertoire.length),4400);return()=>clearInterval(timer);},[animation,working]);
  const name=animation||(working?'reading':repertoire[beat]),a=sheet.animations[name];
  return <span key={name} aria-hidden="true" className="mascot" data-animation={name} style={{backgroundImage:'url("./mascot-sheet.png")','--sprite-size':`${size}px`,'--sprite-count':sheet.frameCount,'--sprite-start':a.start,'--sprite-end':a.start+a.frames,'--sprite-frames':a.frames,'--sprite-duration':`${a.frames*a.ms}ms`} as CSSProperties}/>;
}

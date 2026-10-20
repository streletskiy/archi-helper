import type { CSSProperties } from 'react';

export function Mascot({size=128,working=false}:{size?:number;working?:boolean}){
  return <span aria-hidden="true" className={`mascot ${working?'is-reading':''}`} style={{backgroundImage:'url("./mascot-sheet.png")','--sprite-size':`${size}px`} as CSSProperties}/>;
}

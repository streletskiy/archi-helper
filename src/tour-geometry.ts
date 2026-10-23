/** Placement follows lumv's tour: prefer a side that fits, then clamp and aim its arrow. */
export type TourRect={x:number;y:number;width:number;height:number};
export type TourSize={width:number;height:number};
export type TourPlacement='top'|'bottom'|'left'|'right';
export const clamp=(value:number,min:number,max:number)=>Math.min(Math.max(value,min),Math.max(min,max));
const opposite:Record<TourPlacement,TourPlacement>={top:'bottom',bottom:'top',left:'right',right:'left'};

export function placeCard(target:TourRect,card:TourSize,viewport:TourSize,preferred:TourPlacement){
  const margin=12,gap=14,inset=22;
  const order=[preferred,opposite[preferred],...(['bottom','top','right','left'] as const).filter(side=>side!==preferred&&side!==opposite[preferred])];
  const room={top:target.y,bottom:viewport.height-target.y-target.height,left:target.x,right:viewport.width-target.x-target.width};
  const placement=order.find(side=>room[side]>=(side==='top'||side==='bottom'?card.height:card.width)+gap+margin)||order.reduce((best,side)=>room[side]>room[best]?side:best);
  const vertical=placement==='top'||placement==='bottom',centerX=target.x+target.width/2,centerY=target.y+target.height/2;
  const rawX=vertical?centerX-card.width/2:placement==='right'?target.x+target.width+gap:target.x-gap-card.width;
  const rawY=!vertical?centerY-card.height/2:placement==='bottom'?target.y+target.height+gap:target.y-gap-card.height;
  const x=clamp(rawX,margin,viewport.width-card.width-margin),y=clamp(rawY,margin,viewport.height-card.height-margin);
  const arrow=vertical?clamp(centerX-x,inset,card.width-inset):clamp(centerY-y,inset,card.height-inset);
  return {placement,x:Math.round(x),y:Math.round(y),arrow:Math.round(arrow)};
}

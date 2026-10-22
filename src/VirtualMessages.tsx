import {useCallback,useLayoutEffect,type ReactNode,type RefObject} from 'react';
import {useVirtualizer} from '@tanstack/react-virtual';

export function VirtualMessages({ids,scrollRef,followLatest,render}:{ids:string[];scrollRef:RefObject<HTMLDivElement|null>;followLatest:RefObject<boolean>;render:(index:number)=>ReactNode}){
  const getScrollElement=useCallback(()=>scrollRef.current,[scrollRef]);
  const getItemKey=useCallback((index:number)=>ids[index],[ids]);
  const virtualizer=useVirtualizer({count:ids.length,getScrollElement,getItemKey,estimateSize:()=>180,overscan:6,scrollMargin:20,
    anchorTo:'end',followOnAppend:'auto'});
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange=(item,_delta,instance)=>!followLatest.current&&item.start<(instance.scrollOffset||0);
  useLayoutEffect(()=>{if(followLatest.current&&ids.length)virtualizer.scrollToIndex(ids.length-1,{align:'end'});},[ids.length,virtualizer,followLatest]);
  return <div className="virtual-history" role="list" style={{height:virtualizer.getTotalSize(),position:'relative'}}>
    {virtualizer.getVirtualItems().map(item=><div className="virtual-message" role="listitem" aria-posinset={item.index+1} aria-setsize={ids.length} key={item.key} ref={virtualizer.measureElement} data-index={item.index} data-message-id={ids[item.index]} style={{position:'absolute',top:0,left:0,width:'100%',transform:`translateY(${item.start-virtualizer.options.scrollMargin}px)`}}>{render(item.index)}</div>)}
  </div>;
}

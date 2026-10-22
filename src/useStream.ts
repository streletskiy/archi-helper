import {useCallback,useEffect,useRef,useState} from 'react';
import {createStreamBuffer} from './stream-buffer.mjs';

export function useStream(){
  const [stream,setStream]=useState<Record<string,string>>({});
  const buffer=useRef<ReturnType<typeof createStreamBuffer>|null>(null);
  if(!buffer.current)buffer.current=createStreamBuffer({publish:(batch:Record<string,string>)=>setStream(previous=>{const next={...previous};for(const [id,delta] of Object.entries(batch))next[id]=(next[id]||'')+delta;return next;})});
  const resetStreams=useCallback(()=>{buffer.current?.reset();setStream({});},[]);
  const removeStream=useCallback((id:string)=>{buffer.current?.remove(id);setStream(previous=>{if(!(id in previous))return previous;const next={...previous};delete next[id];return next;});},[]);
  const appendStream=useCallback((id:string,delta:string)=>buffer.current?.append(id,delta),[]);
  useEffect(()=>()=>buffer.current?.dispose(),[]);
  return {stream,resetStreams,removeStream,appendStream};
}

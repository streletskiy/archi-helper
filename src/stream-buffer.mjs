// Keep transport bursts out of React's render loop. Completed/reset messages
// remove their buffered fragments before the next animation frame can publish.
export function createStreamBuffer({publish,schedule=requestAnimationFrame,cancel=cancelAnimationFrame}) {
  const pending=new Map();let frame=null,disposed=false;
  const reset=()=>{if(frame!==null)cancel(frame);frame=null;pending.clear();};
  return {
    append(id,delta){
      if(disposed||!delta)return;
      pending.set(id,(pending.get(id)||'')+delta);
      if(frame===null)frame=schedule(()=>{frame=null;if(disposed||!pending.size)return;const batch=Object.fromEntries(pending);pending.clear();publish(batch);});
    },
    remove(id){pending.delete(id);if(!pending.size&&frame!==null){cancel(frame);frame=null;}},
    reset,
    dispose(){disposed=true;reset();}
  };
}

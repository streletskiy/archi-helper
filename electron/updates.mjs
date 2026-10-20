// Keep installation separate from download: an update must not interrupt work.
export function createUpdates({updater,enabled,version,getBusy,emit,install,
  schedule=(fn,ms)=>setTimeout(fn,ms),cancel=clearTimeout}) {
  let state={status:enabled?'idle':'disabled',version},idle=false,ready=false,deferred=false,timer=null,checking=null;
  const publish=patch=>{state={...state,...patch};emit({type:'update',update:state});};
  const cancelInstall=()=>{if(timer!==null){cancel(timer);timer=null;}};
  const reconcile=()=>{
    cancelInstall();
    if(!ready||deferred||!idle||getBusy()){
      if(ready&&state.status!=='installing')publish({status:'ready',restartAt:null});
      return;
    }
    if(state.status==='installing')return;
    publish({status:'countdown',restartAt:Date.now()+10000});
    timer=schedule(()=>{
      timer=null;
      if(!idle||deferred||getBusy())return reconcile();
      publish({status:'installing',restartAt:null});
      try{install();}catch{ready=false;publish({status:'error',restartAt:null});}
    },10000);
    timer?.unref?.();
  };
  if(enabled){
    updater.autoDownload=true;
    updater.autoInstallOnAppQuit=false; // Never start an installer during Windows shutdown.
    updater.allowPrerelease=false;
    updater.allowDowngrade=false;
    updater.disableWebInstaller=true;
    updater.on('checking-for-update',()=>publish({status:'checking'}));
    updater.on('update-available',info=>publish({status:'downloading',nextVersion:info.version,percent:0}));
    updater.on('download-progress',info=>publish({status:'downloading',percent:Math.round(info.percent)}));
    updater.on('update-not-available',()=>publish({status:'current'}));
    updater.on('update-downloaded',info=>{
      ready=true;
      publish({status:'ready',nextVersion:info.version,percent:100});
      reconcile();
    });
    updater.on('error',()=>{ready=false;cancelInstall();publish({status:'error',restartAt:null});});
  }
  return {
    get state(){return state;},
    setIdle(value){idle=value===true;reconcile();return state;},
    defer(){deferred=true;publish({deferred:true});reconcile();return state;},
    check(){
      if(!enabled||ready)return Promise.resolve(state);
      if(checking)return checking.then(()=>state);
      checking=Promise.resolve().then(()=>updater.checkForUpdates()).catch(()=>{
        publish({status:'error'});
      }).finally(()=>{checking=null;});
      return checking.then(()=>state);
    },
    dispose(){cancelInstall();}
  };
}

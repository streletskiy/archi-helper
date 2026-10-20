const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('archi',{
  call:async(method,input)=>{const r=await ipcRenderer.invoke('archi:call',method,input);if(!r.ok)throw new Error(r.error);return r.value;},
  onEvent:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('archi:event',listener);return ()=>ipcRenderer.removeListener('archi:event',listener);}
});

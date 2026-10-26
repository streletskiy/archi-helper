const {contextBridge,ipcRenderer,webUtils}=require('electron');
contextBridge.exposeInMainWorld('archi',{
  call:async(method,input)=>{const r=await ipcRenderer.invoke('archi:call',method,input);if(!r.ok)throw new Error(r.error);return r.value;},
  attachFiles:async(input,files)=>{
    const sources=[];
    for(const file of files){const path=webUtils.getPathForFile(file);sources.push(path?{path}:{name:file.name,data:new Uint8Array(await file.arrayBuffer())});}
    const r=await ipcRenderer.invoke('archi:call','attachFiles',{...input,files:sources});if(!r.ok)throw new Error(r.error);return r.value;
  },
  onEvent:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('archi:event',listener);return ()=>ipcRenderer.removeListener('archi:event',listener);}
});

import { t } from '../locales/index.mjs';

// IDs identify calls. An index is only a routing hint: compatible providers can
// reuse it for distinct calls, so never concatenate their argument strings.
export function toolCallStream() {
  const calls=new Map(),ids=new Map(),indices=new Map();
  return {
    values:()=>[...calls.values()],
    append(fragment) {
      const id=typeof fragment.id==='string'&&fragment.id?fragment.id:undefined;
      const index=fragment.index;
      if(index!==undefined&&(!Number.isSafeInteger(index)||index<0))throw new Error(t('errors.theProviderReturnedAnIncompleteToolCall'));
      const candidates=indices.get(index);
      let key=id?ids.get(id):undefined;
      if(key===undefined&&candidates?.size===1) {
        const candidate=candidates.values().next().value;
        if(!id||!calls.get(candidate).id)key=candidate;
      }
      if(key===undefined&&!id&&candidates?.size>1)throw new Error(t('errors.ambiguousToolCallFragment'));
      if(key===undefined&&!id&&index===undefined) {
        if(calls.size!==1)throw new Error(t('errors.ambiguousToolCallFragment'));
        key=calls.keys().next().value;
      }
      if(key===undefined)key=calls.size;
      const call=calls.get(key)||{id:'',type:'function',function:{name:'',arguments:''}};
      if(id){call.id=id;ids.set(id,key);}
      if(index!==undefined){const members=indices.get(index)||new Set();members.add(key);indices.set(index,members);}
      if(fragment.function?.name)call.function.name+=fragment.function.name;
      if(fragment.function?.arguments!==undefined&&fragment.function.arguments!==null)
        call.function.arguments+=argumentText(fragment.function.arguments);
      calls.set(key,call);
    }
  };
}

export function argumentText(value) {
  if(typeof value==='string')return value;
  if(value&&typeof value==='object'&&!Array.isArray(value)) {
    if(typeof value.OfString==='string'&&Object.keys(value).every(key=>['OfString','OfResponseToolSearchCallArguments'].includes(key)))return value.OfString;
    return JSON.stringify(value);
  }
  throw new Error(t('errors.theProviderReturnedInvalidToolArguments'));
}

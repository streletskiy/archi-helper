import {AsyncLocalStorage} from 'node:async_hooks';

const observations=new AsyncLocalStorage();
export const currentObservation=()=>observations.getStore()?.run;
export const observationPurpose=()=>observations.getStore()?.purpose||'agent';
export const withObservation=(run,action)=>observations.run({run,purpose:'agent'},action);
export const withObservationPurpose=(purpose,action)=>observations.run({...observations.getStore(),purpose},action);

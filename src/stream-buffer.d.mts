export function createStreamBuffer(options:{publish:(batch:Record<string,string>)=>void;schedule?:(callback:()=>void)=>number;cancel?:(id:number)=>void}):{
  append:(id:string,delta:string)=>void;
  remove:(id:string)=>void;
  reset:()=>void;
  dispose:()=>void;
};

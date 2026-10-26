type ChatMessage={role:string;text:string;status?:string;name?:string;args?:unknown;summary?:string};
export function visibleMessages<T extends ChatMessage>(messages:T[],showTools?:boolean):T[];
export function activityLabel(messages:ChatMessage[],approval?:boolean):string;

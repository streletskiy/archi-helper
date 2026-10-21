export const EFFORTS: string[];
export const FORMATS: string[];
export function needsModelRefresh(provider: {models?:unknown[];catalogVersion?:number;catalogUpdatedAt?:number}): boolean;
export function reasoningProfile(provider: {baseURL:string;reasoningFormat?:string;reasoningEfforts?:string[];models:{id:string;reasoningEfforts?:string[]}[]}|undefined, model: string): {format:string;efforts:string[];toolRestricted?:boolean};
export function selectedEffort(efforts:string[], preferred?:string): string;

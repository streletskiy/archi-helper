export type ProviderDefinition = {
  id:string;name:string;logo?:string;baseURL:string;adapter:string;supportsImages?:boolean;
  catalog?:{path:string;modelsPath:string[]};toolReasoningRestrictions?:string[];
  oauth?:{clientId:string;authorizationURL:string;tokenURL:string;revocationURL?:string;profileURL?:string;
    profileFields?:{id:string;name:string};scopes:string[];redirectPath:string;redirectPort?:number;
    installationParameter?:string;authorizationParameters?:Record<string,string>};
};
export const providerDefinitions:ProviderDefinition[];
export function providerDefinition(provider:{definitionId?:string;baseURL:string}|undefined,definitions?:ProviderDefinition[]):ProviderDefinition|undefined;

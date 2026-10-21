import type { TranslationKey } from '../locales/index.mjs';
export type ProviderDefinition = {
  id:string;name:string;logo?:string;baseURL:string;adapter:string;supportsImages?:boolean;
  catalog?:{path:string;modelsPath:string[]};toolReasoningRestrictions?:string[];
  connectLabel?:TranslationKey;planLabel?:TranslationKey;manageUsageURL?:string;accountCatalog?:boolean;
  oauth?:{clientId:string;authorizationURL:string;tokenURL:string;revocationURL?:string;profileURL?:string;
    profileFields?:{id:string;name:string};scopes:string[];redirectPath:string;redirectPort?:number;
    installationParameter?:string;installationPrefix?:string;authorizationParameters?:Record<string,string>;
    dynamicRegistration?:boolean;agentName?:string;resource?:string;planScope?:string;retainRegistration?:boolean;
    oidc?:{issuer:string;jwksURL:string}};
};
export const providerDefinitions:ProviderDefinition[];
export function providerDefinition(provider:{definitionId?:string;baseURL:string}|undefined,definitions?:ProviderDefinition[]):ProviderDefinition|undefined;

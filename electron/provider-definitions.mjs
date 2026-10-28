// Provider-specific endpoints and capabilities belong here, never in OAuth transport or UI.
// Register additional public clients with their issuer before adding an OAuth configuration.
export const providerDefinitions = [
  {
    id:'lumv', name:'lumv', logo:'providers/lumv.svg', baseURL:'https://lumv.app/v1', adapter:'openai-compatible', supportsImages:true,
    catalog:{path:'opencode/catalog',modelsPath:['providers','lumv','models']},
    toolReasoningRestrictions:['deepseek'],
    oauth:{clientId:'archi-helper',authorizationURL:'https://lumv.app/api/oauth/authorize',
      tokenURL:'https://lumv.app/api/oauth/token',revocationURL:'https://lumv.app/api/oauth/revoke',
      profileURL:'https://lumv.app/api/oauth/me',profileFields:{id:'id',name:'name'},
      scopes:['profile:read','models:read','chat:write','offline_access'],
      redirectPath:'/oauth/callback',installationParameter:'installation_id'},
  },
  {id:'openai',name:'OpenAI',baseURL:'https://api.openai.com/v1',adapter:'openai-compatible'},
  {id:'claude-code',name:'Claude',logo:'providers/claude.svg',baseURL:'https://claude.ai',adapter:'claude-code',supportsImages:true,
    connectLabel:'claude.connect',manageUsageURL:'https://claude.ai/settings/usage'},
  {
    id:'chatgpt',name:'ChatGPT',logo:'providers/chatgpt.svg',logoMonochrome:true,baseURL:'https://api.openai.com/v1',adapter:'openai-responses',supportsImages:true,
    connectLabel:'ui.continueWithChatGPT',planLabel:'ui.usingChatGPTPlan',manageUsageURL:'https://chatgpt.com/settings/usage',
    accountCatalog:true,
    oauth:{clientId:'dynamic_agent_client',dynamicRegistration:true,agentName:'Archi Helper',
      authorizationURL:'https://auth.openai.com/api/accounts/authorize',tokenURL:'https://auth.openai.com/api/accounts/oauth/token',
      revocationURL:'https://auth.openai.com/api/accounts/oauth/revoke',resource:'https://api.openai.com/v1',
      oidc:{issuer:'https://auth.openai.com',jwksURL:'https://auth.openai.com/.well-known/jwks.json'},
      scopes:['openid','profile','email','offline_access','resource.invoke','chatgpt.tokens.use.direct'],
      planScope:'chatgpt.tokens.use.direct',redirectPath:'/auth/callback',
      installationParameter:'ext_agent_host_id',installationPrefix:'urn:uuid:',retainRegistration:true},
  },
  {id:'deepseek',name:'DeepSeek',baseURL:'https://api.deepseek.com',adapter:'openai-compatible'},
  {id:'openrouter',name:'OpenRouter',baseURL:'https://openrouter.ai/api/v1',adapter:'openai-compatible'},
];

export function providerDefinition(provider, definitions=providerDefinitions) {
  if(!provider)return undefined;
  return definitions.find(item=>provider.definitionId ? item.id===provider.definitionId : item.baseURL===provider.baseURL);
}

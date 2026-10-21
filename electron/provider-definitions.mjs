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
  {id:'deepseek',name:'DeepSeek',baseURL:'https://api.deepseek.com',adapter:'openai-compatible'},
  {id:'openrouter',name:'OpenRouter',baseURL:'https://openrouter.ai/api/v1',adapter:'openai-compatible'},
];

export function providerDefinition(provider, definitions=providerDefinitions) {
  if(!provider)return undefined;
  return definitions.find(item=>provider.definitionId ? item.id===provider.definitionId : item.baseURL===provider.baseURL);
}

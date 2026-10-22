import { t } from '../locales/index.mjs';

// All external application requests share Chromium's system proxy support.
// With no system proxy Chromium connects directly. Tests can inject a transport.
let transport;
export function configureAppFetch(fetcher) { transport=fetcher; }
export async function appFetch(input,init) {
  try {
    return await (transport||globalThis.fetch)(input instanceof URL?input.href:input,init);
  } catch(error) {
    if(init?.signal?.aborted||input?.signal?.aborted||['AbortError','TimeoutError'].includes(error.name))throw error;
    let host;
    try {host=new URL(typeof input==='string'||input instanceof URL?input:input.url).hostname;}catch {throw error;}
    throw new Error(t('errors.networkRequestFailed',{host}),{cause:error});
  }
}

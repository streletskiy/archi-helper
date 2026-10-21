import http from 'node:http';
import crypto from 'node:crypto';
import { t } from '../locales/index.mjs';

const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);};

export async function loopbackAuthorization(config,{openExternal,installationId,signal,timeoutMs=15*60*1000}) {
  const state=crypto.randomBytes(32).toString('base64url'),verifier=crypto.randomBytes(32).toString('base64url');
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  let finish,fail,timer,settled=false,redirectUri;
  const result=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
  // Attach a rejection handler while the listener/browser is starting.
  result.catch(()=>{});
  const complete=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?fail(error):finish(value);};
  const cancel=()=>complete(new Error(t('errors.oauthCancelled')));
  const server=http.createServer((request,response)=>{
    response.setHeader('Cache-Control','no-store');response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
    response.setHeader('Content-Type','text/plain; charset=utf-8');
    let url;
    try {url=new URL(request.url,redirectUri);}catch{response.writeHead(400);response.end();return;}
    if(request.method!=='GET'||url.origin!==new URL(redirectUri).origin||url.pathname!==config.redirectPath||request.headers.host!==new URL(redirectUri).host) {
      response.writeHead(404);response.end();return;
    }
    const received=url.searchParams.get('state')||'';
    if(!equal(received,state)||url.searchParams.getAll('state').length!==1) {response.writeHead(400);response.end();return;}
    const code=url.searchParams.get('code');
    if(url.searchParams.has('error')||!code||code.length>4096||url.searchParams.getAll('code').length!==1) {
      response.writeHead(400);response.end(t('errors.oauthCancelled'));complete(new Error(t('errors.oauthCancelled')));return;
    }
    response.end(t('ui.oauthBrowserComplete'));
    complete(null,{code,verifier,redirectUri});
  });
  server.requestTimeout=5000;server.headersTimeout=5000;server.maxConnections=8;
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.redirectPort||0,'127.0.0.1',resolve);});
    server.on('error',error=>complete(error));
    redirectUri=`http://127.0.0.1:${server.address().port}${config.redirectPath}`;
    const url=new URL(config.authorizationURL);
    for(const [key,value] of Object.entries(config.authorizationParameters||{}))url.searchParams.set(key,String(value));
    for(const [key,value] of Object.entries({response_type:'code',client_id:config.clientId,redirect_uri:redirectUri,
      scope:config.scopes.join(' '),state,code_challenge:challenge,code_challenge_method:'S256'}))url.searchParams.set(key,value);
    if(config.installationParameter)url.searchParams.set(config.installationParameter,installationId);
    timer=setTimeout(()=>complete(new Error(t('errors.oauthTimeout'))),timeoutMs);timer.unref();
    signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted)cancel();
    else await openExternal(url.toString());
    return await result;
  } finally {
    clearTimeout(timer);signal?.removeEventListener('abort',cancel);
    server.closeAllConnections();server.close();
  }
}

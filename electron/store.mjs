import { t, normalizeLanguage, setLanguage } from '../locales/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { EFFORTS, FORMATS } from './reasoning.mjs';

export const uid = () => crypto.randomUUID();
// A private workspace for chats started without a user project. Never expose it
// as a regular project or let project deletion target it.
export const INBOX_ID = '00000000-0000-0000-0000-000000000000';
export async function atomicJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${uid()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, file);
}
export async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw new Error(t('errors.cannotRead',{value0:file,value1:e.message})); }
}
export async function projectPath(root, relative = '.') {
  if (typeof relative !== 'string') throw new Error(t('errors.expectedAFileName'));
  const result = path.resolve(root, relative), base = await fs.realpath(root);
  const inside = p => { const r = path.relative(base, p); return !r.startsWith('..') && !path.isAbsolute(r); };
  if (!inside(result)) throw new Error(t('errors.theFileIsOutsideTheProjectFolder'));
  let ancestor = result;
  while (true) {
    try { if (!inside(await fs.realpath(ancestor))) throw new Error(t('errors.theLinkLeadsOutsideTheProject')); break; }
    catch (e) { if (e.code !== 'ENOENT') throw e; ancestor = path.dirname(ancestor); }
  }
  return result;
}
export async function imageFile(root, relative) {
  const file=await projectPath(root,relative),stat=await fs.stat(file);
  if(stat.size>12*1024*1024)throw new Error(t('errors.theImageExceeds12MbResizeIt'));
  const data=await fs.readFile(file);
  const mime=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':
    data[0]===255&&data[1]===216?'image/jpeg':
    data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP'?'image/webp':null;
  if(!mime)throw new Error(t('errors.usePngJpegOrWebpForImage'));
  return {mime,data};
}
export class Store {
  constructor(directory, secrets) { this.directory = path.resolve(directory); this.secrets = secrets; this.migrations=new Map(); }
  async init(defaultLanguage = 'en') {
    this.file = path.join(this.directory, 'settings.json');
    this.state = await readJSON(this.file, { version: 1, projects: [], providers: [], model: '', providerId: '', archicadPort: '' });
    delete this.state.maxContextChars;
    this.state.language = normalizeLanguage(this.state.language || defaultLanguage);
    this.state.reasoningEffort ||= 'xhigh';
    await fs.mkdir(path.join(this.directory, 'inbox'), { recursive: true });
    setLanguage(this.state.language);
  }
  async setLanguage(value) {
    if (!['ru', 'en'].includes(value)) throw new Error(t('errors.unsupportedLanguage'));
    const previous = this.state.language;
    this.state.language = value;
    try { await this.save(); } catch (error) { this.state.language = previous; throw error; }
    setLanguage(value);
  }
  async save() { this.saving=(this.saving||Promise.resolve()).catch(()=>{}).then(()=>atomicJSON(this.file,this.state));await this.saving; }
  publicState() {
    return { ...this.state, providers: this.state.providers.map(({ encryptedKey, encryptedOAuth, ...p }) => ({ ...p, hasKey: !!encryptedKey || !!encryptedOAuth })) };
  }
  async provider(input) {
    const id = input.id || uid();
    const old = this.state.providers.find(p => p.id === id);
    const url = new URL(input.baseURL.trim().replace(/\/+$/, ''));
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      throw new Error(t('errors.useHttpsOrALocalServer'));
    if (url.username || url.password || url.search || url.hash) throw new Error(t('errors.enterABaseUrlWithoutCredentialsQuery'));
    const baseURL=url.toString().replace(/\/+$/, ''), sameEndpoint=old?.baseURL===baseURL;
    const reasoningFormat=input.reasoningFormat||'auto',reasoningEfforts=input.reasoningEfforts||[];
    if(!FORMATS.includes(reasoningFormat)||!Array.isArray(reasoningEfforts)||reasoningEfforts.some(e=>!EFFORTS.includes(e)))throw new Error(t('errors.invalidReasoning'));
    if(old?.oauth) {
      if(!sameEndpoint||input.apiKey?.trim())throw new Error(t('errors.oauthEndpointLocked'));
      old.name=String(input.name||old.name).slice(0,80);old.supportsImages=input.supportsImages===true;
      old.reasoningFormat=reasoningFormat;old.reasoningEfforts=reasoningEfforts;
      await this.save();return this.publicState();
    }
    const provider = { id, name: String(input.name || url.hostname).slice(0,80), baseURL, supportsImages:input.supportsImages===true, reasoningFormat,reasoningEfforts, catalogVersion:sameEndpoint?old?.catalogVersion:undefined, catalogUpdatedAt:sameEndpoint?old?.catalogUpdatedAt:undefined, model:sameEndpoint?old?.model||'':'', models:sameEndpoint?old?.models||[]:[], encryptedKey: input.apiKey?.trim() ? this.secrets.encrypt(input.apiKey.trim()) : sameEndpoint?old?.encryptedKey:undefined };
    if (!provider.encryptedKey && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error(t('errors.enterAnApiKey'));
    this.state.providers = [...this.state.providers.filter(p => p.id !== id), provider];
    this.state.providerId ||= id;
    if(this.state.providerId===id&&!sameEndpoint)this.state.model='';
    await this.save(); return this.publicState();
  }
  selectModel(providerId=this.state.providerId, model) {
    const provider=this.state.providers.find(p=>p.id===providerId);
    if(!provider)throw new Error(t('errors.addAProviderInSettings'));
    const previous=this.state.providers.find(p=>p.id===this.state.providerId);
    if(previous)previous.model=this.state.model;
    this.state.model=model!==undefined?String(model):providerId===this.state.providerId?this.state.model:provider.model||provider.models[0]?.id||'';
    provider.model=this.state.model;this.state.providerId=providerId;
  }
  async deleteProvider(id) {
    this.state.providers=this.state.providers.filter(p=>p.id!==id);
    if(this.state.providerId===id) {
      const next=this.state.providers[0];
      this.state.providerId=next?.id||'';this.state.model=next?.model||next?.models[0]?.id||'';
    }
    await this.save();
  }
  getProvider(id) {
    const p = this.state.providers.find(p => p.id === id);
    if (!p) throw new Error(t('errors.addAProviderInSettings'));
    if(p.oauth)return {...p,apiKey:'',authorize:rejected=>this.oauthManager.access(id,rejected)};
    return { ...p, apiKey: p.encryptedKey ? this.secrets.decrypt(p.encryptedKey) : '' };
  }
  project(id = INBOX_ID) {
    if (id === INBOX_ID) return { id, name: t('ui.withoutProject'), path: path.join(this.directory, 'inbox') };
    const p = this.state.projects.find(p => p.id === id); if (!p) throw new Error(t('errors.projectNotFound')); return p;
  }
  assertActive(projectId, session) {
    if (this.project(projectId).archivedAt || session?.archivedAt) throw new Error(t('errors.restoreBeforeContinuing'));
  }
  async addProject(directory, name) {
    await fs.mkdir(directory, { recursive: true }); directory = await fs.realpath(directory);
    if (directory.toLowerCase().startsWith(this.directory.toLowerCase() + path.sep) || directory.toLowerCase() === this.directory.toLowerCase()) throw new Error(t('errors.profileCannotBeProject'));
    const exists = this.state.projects.find(p => p.path.toLowerCase() === directory.toLowerCase());
    if (exists) { if (exists.archivedAt) throw new Error(t('errors.projectAlreadyArchived')); return exists; }
    const p = { id: uid(), name: name?.trim() || path.basename(directory), path: directory, createdAt: Date.now() };
    this.state.projects.push(p); await this.save(); return p;
  }
  async renameProject(id, name) {
    const project = this.project(id), title = String(name || '').trim().slice(0, 100);
    if (id === INBOX_ID || !title) throw new Error(t('errors.enterAName'));
    const previous = project.name; project.name = title;
    try { await this.save(); } catch (error) { project.name = previous; throw error; }
  }
  async archiveProject(id, archived) {
    const project = this.project(id);
    if (id === INBOX_ID) throw new Error(t('errors.projectNotFound'));
    const previous = project.archivedAt; project.archivedAt = archived ? Date.now() : undefined;
    try { await this.save(); } catch (error) { project.archivedAt = previous; throw error; }
  }
  async deleteProject(id) {
    if (id === INBOX_ID) throw new Error(t('errors.projectNotFound'));
    const root = this.projectStorage(id);
    await Promise.all([...this.sessionWrites?.entries() || []].filter(([file]) => file.startsWith(root + path.sep)).map(([, write]) => write));
    // Detach storage before saving the registry. If saving fails, restore it.
    // Only UUID-validated profile storage is removed, never the source folder.
    const detached = path.join(this.directory, `deleted-project-${uid()}`);
    let moved = false;
    try { await fs.rename(root, detached); moved = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const previous = this.state.projects;
    this.state.projects = previous.filter(project => project.id !== id);
    try { await this.save(); } catch (error) { this.state.projects = previous; if (moved) await fs.rename(detached, root); throw error; }
    if (moved) await fs.rm(detached, { recursive: true, force: true });
    this.migrations.delete(id);
  }
  projectStorage(projectId = INBOX_ID) {
    this.project(projectId);
    if(!/^[a-f0-9-]{36}$/.test(projectId))throw new Error(t('errors.projectNotFound'));
    return path.join(this.directory,'projects',projectId);
  }
  async migrateProject(projectId) {
    if(this.migrations.has(projectId))return this.migrations.get(projectId);
    const migration=(async()=>{
      const root=this.projectStorage(projectId),marker=path.join(root,'migration.json');
      if(await readJSON(marker,null))return;
      await fs.mkdir(path.join(root,'sessions'),{recursive:true});
      if (projectId === INBOX_ID) { await atomicJSON(marker, { version: 1, source: null }); return; }
      let source;
      try { source=await projectPath(this.project(projectId).path,'.archi'); }
      catch (error) { if(error.code!=='ENOENT')throw error; source=path.join(this.project(projectId).path,'.archi'); }
      let exists=true;try{await fs.access(source);}catch(error){if(error.code!=='ENOENT')throw error;exists=false;}
      if(exists) {
        // Copy only; never remove old project data or overwrite newer profile data.
        await fs.cp(source,path.join(root,'legacy','.archi'),{recursive:true,force:false,
          filter:file=>path.relative(source,file).split(path.sep)[0]!=='sessions'});
        const old=path.join(source,'sessions');
        const names=await fs.readdir(old).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
        for(const name of names.filter(name=>/^[a-f0-9-]{36}\.json$/.test(name))) {
          const id=name.slice(0,-5),target=this.sessionFile(projectId,id);
          try{await fs.access(target);continue;}catch(error){if(error.code!=='ENOENT')throw error;}
          const session=await readJSON(await projectPath(this.project(projectId).path,`.archi/sessions/${name}`));
          if(session.id!==id)throw new Error(t('errors.invalidSession'));
          await atomicJSON(target,{...session,projectId,legacyProjectFiles:true});
        }
      }
      await atomicJSON(marker,{version:1,copiedAt:new Date().toISOString(),source:exists?source:null});
    })();
    this.migrations.set(projectId,migration);
    try{await migration;}catch(error){this.migrations.delete(projectId);throw error;}
  }
  async workspace(projectId,id) {
    this.sessionFile(projectId,id);
    await this.migrateProject(projectId);
    const root=path.join(this.projectStorage(projectId),'workspaces',id);
    await fs.mkdir(root,{recursive:true});return root;
  }
  async resolveFile(projectId,id,relative='.',{scope='session',write=false}={}) {
    if(typeof relative!=='string')throw new Error(t('errors.expectedAFileName'));
    const prefix=/^(project|session):\//.exec(relative);
    if(prefix){scope=prefix[1];relative=relative.slice(prefix[0].length);}
    if(!['project','session'].includes(scope))throw new Error(t('errors.invalidFileScope'));
    const workspace=await this.workspace(projectId,id),project=this.project(projectId).path;
    if(path.isAbsolute(relative)) {
      const child=path.relative(workspace,relative);
      scope=!child.startsWith('..')&&!path.isAbsolute(child)?'session':'project';
    }
    const root=scope==='project'?project:workspace,file=await projectPath(root,relative);
    if(write)return {file,root,scope};
    try{await fs.access(file);return {file,root,scope};}catch(error){if(error.code!=='ENOENT')throw error;}
    if(scope==='session') {
      if(relative.replaceAll('\\','/').startsWith('.archi/')) {
        const legacy=path.join(this.projectStorage(projectId),'legacy');
        try{const old=await projectPath(legacy,relative);await fs.access(old);return {file:old,root:legacy,scope:'legacy'};}
        catch(error){if(error.code!=='ENOENT')throw error;}
      }
      const session=await this.session(projectId,id);
      if(session.legacyProjectFiles) {
        const old=await projectPath(project,relative);
        try{await fs.access(old);return {file:old,root:project,scope:'project'};}catch(error){if(error.code!=='ENOENT')throw error;}
      }
    }
    throw new Error(t('errors.workspaceFileMissing',{path:relative,scope:t(scope==='project'?'ui.projectFiles':'ui.chatFiles')}));
  }
  async image(projectId,id,relative,options) {
    const location=await this.resolveFile(projectId,id,relative,options);
    return imageFile(location.root,location.file);
  }
  sessionFile(projectId, id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error(t('errors.invalidSession'));
    return path.join(this.projectStorage(projectId),'sessions',`${id}.json`);
  }
  async sessions(projectId) {
    await this.migrateProject(projectId);
    const dir = path.join(this.projectStorage(projectId),'sessions');
    await fs.mkdir(dir, { recursive: true });
    const all = await Promise.all((await fs.readdir(dir)).filter(x=>x.endsWith('.json')).map(async name=>{
      const s = await readJSON(path.join(dir, name)); return { id:s.id, projectId, title:s.title, updatedAt:s.updatedAt, archivedAt:s.archivedAt, count:s.messages.length };
    }));
    return all.sort((a,b)=>b.updatedAt-a.updatedAt);
  }
  async session(projectId, id) {
    const file=this.sessionFile(projectId,id);await this.migrateProject(projectId);
    const s=await readJSON(file);if(!s)throw new Error(t('errors.sessionNotFound'));
    if(s.id!==id||s.projectId!==projectId)throw new Error(t('errors.invalidSession'));return s;
  }
  async newSession(projectId = INBOX_ID, title = t('ui.newSession')) {
    this.assertActive(projectId);
    await this.migrateProject(projectId);
    const s = { id:uid(), projectId, title, updatedAt:Date.now(), messages:[], history:[] }; await this.saveSession(s); return s;
  }
  async saveSession(s) {
    s.updatedAt=Date.now();const file=this.sessionFile(s.projectId,s.id),snapshot=structuredClone(s);
    this.sessionWrites??=new Map();
    const write=(this.sessionWrites.get(file)||Promise.resolve()).catch(()=>{}).then(()=>atomicJSON(file,snapshot));
    this.sessionWrites.set(file,write);
    try{await write;}finally{if(this.sessionWrites.get(file)===write)this.sessionWrites.delete(file);}
  }
  async archiveSession(projectId, id, archived) {
    const session = await this.session(projectId, id);
    session.archivedAt = archived ? Date.now() : undefined;
    await this.saveSession(session);
  }
  async deleteSession(projectId, id) {
    const file = this.sessionFile(projectId, id);
    await this.session(projectId, id);
    await this.sessionWrites?.get(file);
    await fs.rm(path.join(this.projectStorage(projectId), 'workspaces', id), { recursive: true, force: true });
    await fs.unlink(file);
  }
  async moveDraft(projectId, id, targetProjectId) {
    const session = await this.session(projectId, id);
    this.assertActive(projectId, session); this.assertActive(targetProjectId);
    if (session.messages.length || session.history.length || session.pendingMessages?.length) throw new Error(t('errors.onlyEmptyDraftCanMove'));
    if (projectId === targetProjectId) return session;
    const source = await this.workspace(projectId, id);
    await this.migrateProject(targetProjectId);
    const target = path.join(this.projectStorage(targetProjectId), 'workspaces', id);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(source, target);
    session.projectId = targetProjectId;
    try { await this.saveSession(session); }
    catch (error) { await fs.rename(target, source); throw error; }
    await fs.unlink(this.sessionFile(projectId, id));
    return session;
  }
  async artifact(projectId, sessionId, name, value) {
    const relative = `.archi/results/${sessionId}/${Date.now()}-${uid().slice(0,8)}-${name.replace(/[^a-z0-9_.-]/gi,'_')}.json`;
    const file = await projectPath(await this.workspace(projectId,sessionId), relative);
    await atomicJSON(file,value);
    const bytes=(await fs.stat(file)).size;
    return { path:relative, bytes };
  }
}

import { t, normalizeLanguage, setLanguage } from '../locales/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { EFFORTS, FORMATS } from './reasoning.mjs';

export const uid = () => crypto.randomUUID();
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
  constructor(directory, secrets) { this.directory = directory; this.secrets = secrets; }
  async init(defaultLanguage = 'en') {
    this.file = path.join(this.directory, 'settings.json');
    this.state = await readJSON(this.file, { version: 1, projects: [], providers: [], model: '', providerId: '', archicadPort: '', maxContextChars: 180000 });
    this.state.language = normalizeLanguage(this.state.language || defaultLanguage);
    this.state.reasoningEffort ||= 'xhigh';
    setLanguage(this.state.language);
  }
  async setLanguage(value) {
    if (!['ru', 'en'].includes(value)) throw new Error(t('errors.unsupportedLanguage'));
    const previous = this.state.language;
    this.state.language = value;
    try { await this.save(); } catch (error) { this.state.language = previous; throw error; }
    setLanguage(value);
  }
  async save() { await atomicJSON(this.file, this.state); }
  publicState() {
    return { ...this.state, providers: this.state.providers.map(({ encryptedKey, ...p }) => ({ ...p, hasKey: !!encryptedKey })) };
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
    const provider = { id, name: String(input.name || url.hostname).slice(0,80), baseURL, supportsImages:input.supportsImages===true, reasoningFormat,reasoningEfforts, catalogVersion:sameEndpoint?old?.catalogVersion:undefined, model:sameEndpoint?old?.model||'':'', models:sameEndpoint?old?.models||[]:[], encryptedKey: input.apiKey?.trim() ? this.secrets.encrypt(input.apiKey.trim()) : old?.encryptedKey };
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
    return { ...p, apiKey: p.encryptedKey ? this.secrets.decrypt(p.encryptedKey) : '' };
  }
  project(id) { const p = this.state.projects.find(p => p.id === id); if (!p) throw new Error(t('errors.projectNotFound')); return p; }
  async addProject(directory, name) {
    await fs.mkdir(directory, { recursive: true }); directory = await fs.realpath(directory);
    const exists = this.state.projects.find(p => p.path.toLowerCase() === directory.toLowerCase()); if (exists) return exists;
    const p = { id: uid(), name: name?.trim() || path.basename(directory), path: directory, createdAt: Date.now() };
    await fs.mkdir(path.join(directory, '.archi', 'sessions'), { recursive: true });
    this.state.projects.push(p); await this.save(); return p;
  }
  sessionFile(projectId, id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error(t('errors.invalidSession'));
    return path.join(this.project(projectId).path, '.archi', 'sessions', `${id}.json`);
  }
  async sessions(projectId) {
    const dir = path.join(this.project(projectId).path, '.archi', 'sessions');
    await fs.mkdir(dir, { recursive: true });
    const all = await Promise.all((await fs.readdir(dir)).filter(x=>x.endsWith('.json')).map(async name=>{
      const s = await readJSON(path.join(dir, name)); return { id:s.id, title:s.title, updatedAt:s.updatedAt, count:s.messages.length };
    }));
    return all.sort((a,b)=>b.updatedAt-a.updatedAt);
  }
  async session(projectId, id) { const s = await readJSON(this.sessionFile(projectId,id)); if (!s) throw new Error(t('errors.sessionNotFound')); return s; }
  async newSession(projectId, title = t('ui.newSession')) {
    const s = { id:uid(), projectId, title, updatedAt:Date.now(), messages:[], history:[] }; await this.saveSession(s); return s;
  }
  async saveSession(s) { s.updatedAt = Date.now(); await atomicJSON(this.sessionFile(s.projectId,s.id), s); }
  async artifact(projectId, sessionId, name, value) {
    const relative = `.archi/results/${sessionId}/${Date.now()}-${uid().slice(0,8)}-${name.replace(/[^a-z0-9_.-]/gi,'_')}.json`;
    const file = await projectPath(this.project(projectId).path, relative);
    await atomicJSON(file,value);
    const bytes=(await fs.stat(file)).size;
    return { path:relative, bytes };
  }
}

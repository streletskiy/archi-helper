import en from './en.json' with { type: 'json' };
import ru from './ru.json' with { type: 'json' };

export const catalogs = { en, ru };
let language = 'en';
const listeners = new Set();
export const normalizeLanguage = value => String(value || '').toLowerCase().split(/[-_]/)[0] === 'ru' ? 'ru' : 'en';
export const getLanguage = () => language;
export function setLanguage(value) {
  const next = normalizeLanguage(value);
  if (next === language) return;
  language = next;
  for (const listener of listeners) listener();
}
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function translate(locale, key, values = {}) {
  const template = catalogs[normalizeLanguage(locale)][key] ?? en[key];
  if (template === undefined) throw new Error(`Missing translation: ${key}`);
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : match);
}
export const t = (key, values) => translate(language, key, values);

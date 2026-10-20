import { useSyncExternalStore } from 'react';
import { getLanguage, subscribe } from '../locales/index.mjs';
export { t, setLanguage } from '../locales/index.mjs';
export const useLanguage = () => useSyncExternalStore(subscribe, getLanguage);

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { t } from './i18n';

export type ThemeMode = 'system' | 'light' | 'dark';
const modes: ThemeMode[] = ['system', 'light', 'dark'];
const icons = { system: Monitor, light: Sun, dark: Moon };

export function ThemeControl({ value, disabled, onChange }: { value: ThemeMode; disabled?: boolean; onChange: (value: ThemeMode) => Promise<unknown> }) {
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const Icon = icons[value];
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') || [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp' ? (index + buttons.length - 1) % buttons.length : -1;
    if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
  };
  return <div className="theme-control" ref={root}>
    <button ref={trigger} className="icon-button theme-trigger" aria-label={t('theme.choose')} title={t('theme.current', { value: t(`theme.${value}`) })} aria-haspopup="menu" aria-expanded={open} disabled={disabled || pending} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}><Icon size={16}/></button>
    {open && <div className="theme-menu" role="menu" aria-label={t('theme.choose')} onKeyDown={keys}>{modes.map(mode => {
      const ModeIcon = icons[mode];
      return <button key={mode} role="menuitemradio" aria-checked={value === mode} disabled={pending} onClick={async () => { setPending(true); try { await onChange(mode); close(); } finally { setPending(false); } }}><ModeIcon size={16}/><span>{t(`theme.${mode}`)}</span>{value === mode && <Check size={14}/>}</button>;
    })}</div>}
  </div>;
}

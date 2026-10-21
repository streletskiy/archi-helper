import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Ellipsis, Folder, FolderPlus, Search, X } from 'lucide-react';
import { t, useLanguage } from './i18n';

export type Project = { id: string; name: string; path: string; archivedAt?: number };
export type WorkspaceAction = { label: string; icon: ReactNode; onClick: () => void; danger?: boolean };

export function ActionMenu({ label, actions, disabled }: { label: string; actions: WorkspaceAction[]; disabled?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) ref.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, []);
  return <details className="action-menu" ref={ref} onToggle={() => {
    const element=ref.current,panel=element?.querySelector<HTMLElement>('.action-menu-items');
    if(!element?.open||!panel)return;
    const box=element.getBoundingClientRect();
    panel.style.left=`${Math.max(12,Math.min(window.innerWidth-panel.offsetWidth-12,box.right-panel.offsetWidth))}px`;
    panel.style.top=`${Math.max(12,Math.min(window.innerHeight-panel.offsetHeight-12,box.bottom+4))}px`;
  }}>
    <summary aria-label={label} title={label} aria-disabled={disabled} tabIndex={disabled ? -1 : 0} onClick={event => { if (disabled) event.preventDefault(); }}><Ellipsis size={17}/></summary>
    <div className="action-menu-items">{actions.map(action => <button key={action.label} disabled={disabled} className={action.danger ? 'danger-text' : ''} onClick={() => { ref.current?.removeAttribute('open'); action.onClick(); }}>{action.icon}{action.label}</button>)}</div>
  </details>;
}

export function ProjectPicker({ projects, project, disabled, onSelect, onCreate }: {
  projects: Project[]; project: Project | null; disabled?: boolean;
  onSelect: (project: Project | null) => void; onCreate: () => void;
}) {
  useLanguage();
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const filtered = projects.filter(p => !p.archivedAt && `${p.name} ${p.path}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="project-context" ref={ref} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
    <button ref={trigger} className="project-context-trigger" aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => { setQuery(''); setOpen(value => !value); }} title={project?.path}><Folder size={16}/><span>{project?.name || t('ui.withoutProject')}</span><ChevronDown size={13}/></button>
    {open && <div className="project-picker" role="dialog" aria-label={t('ui.chooseProject')}>
      <label className="project-picker-search"><Search size={16}/><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={t('ui.searchProjects')} aria-label={t('ui.searchProjects')}/></label>
      <button className="picker-new" onClick={() => { close(); onCreate(); }}><FolderPlus size={18}/>{t('ui.newProject')}</button>
      <div className="project-picker-list">{filtered.map(p => <button key={p.id} title={p.path} onClick={() => { close(); onSelect(p); }}><Folder size={18}/><span>{p.name}</span>{project?.id === p.id && <Check size={16}/>}</button>)}{!filtered.length && <p className="workspace-empty">{t('ui.noProjectsFound')}</p>}</div>
      <button className="picker-unassigned" onClick={() => { close(); onSelect(null); }}><X size={17}/><span>{t('ui.workWithoutProject')}</span>{!project && <Check size={16}/>}</button>
    </div>}
  </div>;
}

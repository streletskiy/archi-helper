import {t,useLanguage} from './i18n';
import {groupModels,modelCategory,type SelectableModel} from './model-selection.mjs';

export function ModelSelect({models=[],value,disabled,onChange,onFocus}:{
  models?:SelectableModel[];value:string;disabled:boolean;onChange:(model:string)=>void;onFocus:()=>void;
}) {
  useLanguage();
  const groups=groupModels(models,value);
  const label=(model:SelectableModel)=>{
    const name=model.name||model.id,category=modelCategory(model);
    return category==='recommended'?`★ ${name}`:category==='expensive'?`${name} · ${t('ui.expensiveModel')}`:name;
  };
  const selected=models.find(model=>model.id===value)||{id:value};
  const headings={recommended:'ui.recommendedModels',other:'ui.otherModels',expensive:'ui.expensiveModels'} as const;
  return <select className="model-select" title={value?label(selected):t('ui.chooseAModel')} aria-label={t('ui.model')} value={value} disabled={disabled} onFocus={onFocus} onChange={event=>onChange(event.target.value)}>
    <option value="">{t('ui.chooseAModel')}</option>
    {groups.map(group=><optgroup key={group.category} label={t(headings[group.category])}>
      {group.models.map(model=><option key={model.id} value={model.id}>{label(model)}</option>)}
    </optgroup>)}
  </select>;
}

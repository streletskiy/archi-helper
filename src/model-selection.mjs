// Presentation rules only: keep provider IDs, metadata and the selected model intact.
// Normalize punctuation/case, but keep version components distinct (6.1 != 6.10).
const normalized=value=>String(value||'').normalize('NFKC').toLowerCase()
  .replace(/([a-z])(\d)/g,'$1-$2').replace(/(\d)([a-z])/g,'$1-$2')
  .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const recommended=[
  /(?:^|-)gpt-6-1-sol(?:-|$)/,
  /(?:^|-)(?:haiku-5-5|claude-5-5-haiku)(?:-|$)/,
  /(?:^|-)deepseek-(?:(?:v-)?4-1-flash|flash-(?:v-)?4-1)(?:-|$)/,
];
const expensive=/(?:^|-)(?:astra|fable|argon)(?:-|$)/;

export function modelCategory(model) {
  const names=[model.id,model.name].map(normalized);
  if(names.some(name=>expensive.test(name)))return 'expensive';
  if(names.some(name=>recommended.some(pattern=>pattern.test(name))))return 'recommended';
  return 'other';
}

export function groupModels(models=[],selected='') {
  const groups={recommended:[],other:[],expensive:[]};
  // A manually entered or removed ID stays selectable, in its appropriate group.
  const available=selected&&!models.some(model=>model.id===selected)?[...models,{id:selected,name:selected}]:models;
  for(const model of available)groups[modelCategory(model)].push(model);
  return Object.entries(groups).filter(([,items])=>items.length).map(([category,models])=>({category,models}));
}

import fs from 'node:fs/promises';
import { t } from '../locales/index.mjs';

export const ZONE_AREA_LABEL_RECIPE='zone-stamp-area-label';
const articles=Object.freeze([
  Object.freeze({id:ZONE_AREA_LABEL_RECIPE,title:'Override the displayed area in a specific zone stamp',summary:'Custom stamp text only; preserve zone geometry and calculated areas. Stamp-specific procedure, pilot and verification required.',requiresExplicitApproval:true})
]);

export async function getKnowledge(id) {
  if(!id)return {articles};
  const article=articles.find(item=>item.id===id);
  if(!article)throw new Error(t('agent.unknownKnowledge',{id}));
  return {...article,text:await fs.readFile(new URL(`./knowledge/${article.id}.md`,import.meta.url),'utf8')};
}

// These are conservative reminders for recognizable calls, not a Python sandbox.
// The declared recipe also covers scripts that load parameters from another file.
export function zoneAreaLabelApproval(name,args) {
  if(args.knowledge_id===ZONE_AREA_LABEL_RECIPE)return true;
  const customParameter=/^(?:iOrder_1_temp|iOrder_1|prefixCustomText|contentCustomText)$/i;
  const command=String(args.name||'').split(':').pop();
  const parameters=command==='RunTapirCommand'?args.arguments?.parameters:args.arguments;
  const target=command==='RunTapirCommand'?args.arguments?.command:command;
  if(name==='call_archicad' && target==='SetGDLParametersOfElements') {
    return parameters?.elementsWithGDLParameters?.some(element=>
      element.gdlParameters?.some(parameter=>customParameter.test(parameter.name||'')))===true;
  }
  return name==='run_python' && /SetGDLParametersOfElements/i.test(args.code||'') &&
    /\b(?:iOrder_1_temp|iOrder_1|prefixCustomText|contentCustomText)\b/i.test(args.code||'');
}

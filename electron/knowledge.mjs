import fs from 'node:fs/promises';
import { t } from '../locales/index.mjs';

export const ZONE_AREA_LABEL_RECIPE='zone-stamp-area-label';
const articles=Object.freeze([
  Object.freeze({id:ZONE_AREA_LABEL_RECIPE,title:'Override the displayed area in a specific zone stamp',summary:'Custom stamp text only; preserve zone geometry and calculated areas. Stamp-specific procedure, pilot and verification required.',requiresExplicitApproval:true}),
  Object.freeze({id:'interactive-schedules',title:'Interactive schedules: Tapir, built-in Graphisoft API and supported alternatives',summary:'Distinguish navigator items and model properties from schedule cells, schemes and formatting. Check version-specific JSON/Python capabilities before choosing direct API, export or a separate Add-On.',requiresExplicitApproval:false}),
  Object.freeze({id:'archicad-capabilities',title:'Version-specific Archicad capabilities and tool shortcuts',summary:'AC25/Tapir 1.7.2 observations, navigator/database identifiers, JSON envelopes, exact tool routes and limits. Historical evidence, not a universal support promise.',verifiedOn:[{archicad:25,build:7000,tapir:'1.7.2'}],requiresExplicitApproval:false}),
  Object.freeze({id:'layout-audit',title:'Complete layout audit and local PDF export',summary:'Registry first; discover publisher sets, export without an extra prompt, verify actual PDFs and page mapping. Separate metadata, text and visual coverage; reconcile reports against evidence.',verifiedOn:[{archicad:25,build:7000,tapir:'1.7.2'}],requiresExplicitApproval:false})
]);

export function knowledgeIndex(connection) {
  const current=connection?{archicad:Number(connection.archicad_version),build:Number(connection.archicad_build),tapir:connection.tapir_installed}:null;
  return {connection:current,articles:articles.map(article=>({...article,
    ...(article.verifiedOn?{matchesRecordedConnection:!!current&&article.verifiedOn.some(item=>item.archicad===current.archicad&&item.build===current.build&&item.tapir===current.tapir)}:{})}))};
}

export async function getKnowledge(id,connection) {
  if(!id)return knowledgeIndex(connection);
  const article=articles.find(item=>item.id===id);
  if(!article)throw new Error(t('agent.unknownKnowledge',{id}));
  return {...knowledgeIndex(connection).articles.find(item=>item.id===id),text:await fs.readFile(new URL(`./knowledge/${article.id}.md`,import.meta.url),'utf8')};
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

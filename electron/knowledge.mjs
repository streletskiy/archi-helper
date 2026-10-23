import { KnowledgeLibrary } from './knowledge-library.mjs';

export const ZONE_AREA_LABEL_RECIPE='zone-stamp-area-label';
const bundled=new KnowledgeLibrary();
export const knowledgeIndex=connection=>bundled.search({},undefined,connection);
export const getKnowledge=(id,connection)=>bundled.search({id},undefined,connection);

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

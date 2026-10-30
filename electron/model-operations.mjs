import path from 'node:path';
import {runOperation,OperationError,elementRefs,identifier} from './operation-core.mjs';
import {imageFile} from './store.mjs';
import {t} from '../locales/index.mjs';
import {validatePng} from './png-validation.mjs';

export async function projectOverview(context,args={}) {
  return runOperation(context,'get_project_overview',args,async op=>{
    const connection=await op.call('TestConnection');
    const project=await op.call('GetProjectInfo');
    const sections={},unavailable=[];
    for(const [key,name] of [['stories','GetStories'],['selection','GetSelectedElements'],['window','GetCurrentWindowType']]){
      if(op.has(name)){try{sections[key]=await op.call(name);}catch(error){if(op.signal.aborted)throw error;unavailable.push({section:key,error:error.message});}}
      else unavailable.push({section:key,status:'unsupported'});
    }
    const capabilities=Object.fromEntries(['SaveCurrentWindowAsImage','FitInWindow','GetDetailsOfElements','GetPropertyValuesOfElements','GetQuantitiesOfElements','GetNavigatorItemTree','GetPublisherSetNames','PublishPublisherSet','SetDetailsOfElements'].map(name=>[name,op.has(name)]));
    op.manifest.checks.push('live_connection','project_metadata');
    return {status:unavailable.length?'partial':'completed',connection,project,sections,capabilities,unavailable,
      capabilityScope:'Advertised command availability; individual calls may still be unsupported by the installed Add-On.'};
  });
}

export async function captureView(context,args={}) {
  return runOperation(context,'capture_view',args,async op=>{
    if(args.navigator_item_id&&args.window_type||args.story_index!==undefined&&args.window_type!=='FloorPlan'||args.element_ids?.length&&!args.fit)throw new OperationError(t('operations.invalidInput',{field:'view/fit'}));
    // Check all required commands before changing the user's active view.
    op.tool('SaveCurrentWindowAsImage');op.tool('GetCurrentWindowType');
    if(args.navigator_item_id||args.window_type)op.tool('ChangeWindow');
    if(args.fit)op.tool('FitInWindow');
    const before=await op.call('GetCurrentWindowType');
    let previousStory,projection,changed=false,restoration={status:'not_requested'};
    if(args.restore_view){
      if(before.currentWindowType==='FloorPlan'&&op.has('GetStories'))previousStory=(await op.call('GetStories')).actStory;
      if(before.currentWindowType==='3DModel'&&op.has('Get3DProjectionSettings'))projection=await op.call('Get3DProjectionSettings');
    }
    let captured;
    try{
      if(args.navigator_item_id){await op.call('ChangeWindow',{navigatorItemId:{guid:args.navigator_item_id}});changed=true;}
      else if(args.window_type){await op.call('ChangeWindow',{windowType:args.window_type,...(args.story_index!==undefined?{storyIndex:args.story_index}:{})});changed=true;}
      if(args.fit){await op.call('FitInWindow',args.element_ids?.length?{elements:elementRefs(args.element_ids)}:{});changed=true;}
      const view=await op.call('GetCurrentWindowType');
      if(args.window_type&&view.currentWindowType!==args.window_type)throw new OperationError(t('operations.wrongView'));
      const file=path.join(op.directory,'capture.png');
      await op.call('SaveCurrentWindowAsImage',{imageFilePath:file,format:'png',...(args.entire_drawing?{entireDrawing:true}:{})});
      const imagePath=`${op.relative}/capture.png`,{data,mime}=await imageFile(op.root,imagePath);
      if(mime!=='image/png')throw new OperationError(t('operations.invalidImage'));
      let width,height;try{({width,height}=validatePng(data));}catch{throw new OperationError(t('operations.invalidImage'));}
      op.manifest.checks.push('fresh_output_path','png_chunk_integrity','decoded_scanlines','nonzero_dimensions','active_window_type');
      captured={imagePath,mime,bytes:data.length,width,height,view,before,shownToUser:args.show_to_user!==false,caption:String(args.caption||t('operations.captureCaption')).trim()};
    }finally{
      if(args.restore_view&&changed){
        restoration={status:'partial',restored:[],unrestorable:['original_zoom_and_exact_database']};
        if(!op.signal.aborted){
          try{
            if(before.currentWindowType==='FloorPlan'&&Number.isInteger(previousStory)){
              await op.call('ChangeWindow',{windowType:'FloorPlan',storyIndex:previousStory});restoration.restored.push('window_type','story');
            }else if(before.currentWindowType==='3DModel'){
              await op.call('ChangeWindow',{windowType:'3DModel'});restoration.restored.push('window_type');
              if(projection?.isPersp&&op.has('Set3DProjectionSettings')){await op.call('Set3DProjectionSettings',{perspective:projection.perspective});restoration.restored.push('perspective');}
            }
          }catch(error){restoration.error=error.message;}
        }
        op.manifest.warnings.push(t('operations.restorePartial'));
      }else if(args.restore_view)restoration={status:'unchanged'};
      op.manifest.restoration=restoration;
    }
    return {...captured,restoration};
  });
}

const errorOf=value=>value?.error||value?.isError===true||value?.success===false||value?.propertyValues?.some(item=>item?.error);
const units='Use each command/field schema. Geometry lengths are generally meters, while some text and paper-space sizes are millimeters; detail fields do not share one unit.';
export async function inspectElements(context,args={}) {
  return runOperation(context,'inspect_elements',args,async op=>{
    if([args.selection,args.element_type,args.element_ids?.length].filter(Boolean).length>1||args.filters?.length&&!args.element_type)throw new OperationError(t('operations.invalidInput',{field:'element scope'}));
    const batchSize=args.batch_size??100,limit=args.limit??1000;
    if(!Number.isInteger(batchSize)||batchSize<1||batchSize>250||!Number.isInteger(limit)||limit<1||limit>50000)throw new OperationError(t('operations.invalidInput',{field:'batch_size/limit'}));
    let refs;
    if(args.element_ids?.length)refs=elementRefs(args.element_ids);
    else {
      const name=args.selection==='all'?'GetAllElements':args.element_type?'GetElementsByType':'GetSelectedElements';
      const input=args.element_type&&name==='GetElementsByType'?{elementType:args.element_type,...(args.filters?.length?{filters:args.filters}:{})}:{};
      const data=await op.call(name,input);
      if(!Array.isArray(data?.elements))throw new OperationError(t('operations.invalidResponse',{command:name}));
      refs=elementRefs(data.elements.map(identifier).filter(Boolean));
    }
    const available=refs.length;refs=refs.slice(0,limit);
    const records=[],failures=[],unsupported=[];
    const detailTool=op.tool('GetDetailsOfElements');
    const fields=args.fields?.length?args.fields:['type','id','floorIndex','layerIndex','drawIndex','details'];
    if(!detailTool.inputSchema?.properties?.fields&&args.fields?.length)throw new OperationError(t('operations.schemaUnavailable',{field:'GetDetailsOfElements.fields'}),'unsupported');
    const readers=[{name:'GetDetailsOfElements',key:'detailsOfElements',target:'details',input:detailTool.inputSchema?.properties?.fields?{fields}:{}}];
    if(args.property_ids?.length)readers.push({name:'GetPropertyValuesOfElements',key:'propertyValuesForElements',target:'properties',input:{properties:args.property_ids.map(guid=>({propertyId:{guid}}))}});
    if(args.quantities)readers.push({name:'GetQuantitiesOfElements',key:'quantitiesOfElements',target:'quantities',input:{}});
    const supported=readers.filter(reader=>{if(op.has(reader.name))return true;unsupported.push(reader.name);return false;});
    for(let offset=0;offset<refs.length;offset+=batchSize){
      op.signal.throwIfAborted();
      const batch=refs.slice(offset,offset+batchSize),rows=batch.map(ref=>({elementId:ref.elementId}));
      for(const reader of supported){
        try{
          const {data,failed}=await op.call(reader.name,{elements:batch,...reader.input},{allowPartial:true,envelope:true});
          const values=data?.[reader.key];
          if(!Array.isArray(values)||values.length!==batch.length)throw new OperationError(t('operations.invalidResponse',{command:reader.name}));
          values.forEach((value,i)=>{rows[i][reader.target]=value;if(errorOf(value))failures.push({elementId:rows[i].elementId,section:reader.target,error:value});});
          if(failed&&!values.some(errorOf))failures.push({offset,section:reader.target,error:t('operations.commandFailed',{command:reader.name})});
        }catch(error){if(op.signal.aborted)throw error;failures.push({offset,section:reader.target,error:error.message});}
      }
      records.push(...rows);await op.save('elements.json',{records,failures,unsupported,available,processed:records.length});
    }
    const countsByType={};for(const record of records){const type=record.details?.type||'unknown';countsByType[type]=(countsByType[type]||0)+1;}
    const truncated=available>refs.length;
    const saved=await op.save('elements.json',{records,failures,unsupported,available,processed:records.length,units});
    op.manifest.checks.push('explicit_element_scope','response_order_and_cardinality','per_element_error_detection');
    return {status:failures.length||unsupported.length||truncated?'partial':'completed',saved,available,processed:records.length,truncated,countsByType,failures:failures.slice(0,20),failureCount:failures.length,unsupported,sample:records.slice(0,3),
      units,coverage:'Element data only; this is not a read of configured Interactive Schedule cells.'};
  });
}

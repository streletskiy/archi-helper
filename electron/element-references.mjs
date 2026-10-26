// Remove only redundant elementId envelopes when the live schema expects
// a GUID object. Never infer identifiers or discard sibling fields.
export function normalizeElementReferences(value,schema) {
  if(!schema||!value||typeof value!=='object')return value;
  if(Array.isArray(value))return schema.type==='array'?value.map(item=>normalizeElementReferences(item,schema.items)):value;
  if(schema.type!=='object'||!schema.properties)return value;
  return Object.fromEntries(Object.entries(value).map(([key,item])=>{
    const expected=schema.properties[key];
    if(key==='elementId'&&expected?.type==='object'&&expected.properties?.guid?.type==='string'&&expected.required?.includes('guid')&&!expected.properties.elementId) {
      let candidate=item;
      while(candidate&&typeof candidate==='object'&&!Array.isArray(candidate)&&Object.keys(candidate).length===1&&Object.hasOwn(candidate,'elementId'))candidate=candidate.elementId;
      if(candidate&&typeof candidate==='object'&&!Array.isArray(candidate)&&Object.keys(candidate).length===1&&typeof candidate.guid==='string')item=candidate;
    }
    return [key,normalizeElementReferences(item,expected)];
  }));
}

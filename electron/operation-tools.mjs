const string=description=>({type:'string',description});
const ids=description=>({type:'array',minItems:1,maxItems:50000,uniqueItems:true,items:{type:'string',pattern:'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'},description});
const fn=(name,description,properties,required=[])=>({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}});

export const operationTools=[
  fn('get_project_overview','Read the current connection, project metadata, stories, selection, active window and available built-in operation prerequisites in one call. Does not save or change the PLN. Use before planning instead of repeatedly discovering basic read commands.',{}),
  fn('capture_view','Capture a fresh PNG of the current or specified Archicad view, optionally fitting elements or the whole view. Validates the saved file and active window and displays the image by default. Does not save the PLN. Unavailable in read-only mode. restore_view makes a best-effort restoration of the floor/story or 3D perspective; exact database/zoom restoration is not available and is explicitly reported. No desktop capture. Do not repeat with view_image/show_image.',{
    navigator_item_id:string('Exact navigator item GUID from the current project. Mutually exclusive with window_type.'),
    window_type:{type:'string',enum:['FloorPlan','3DModel','Layout','Section','Elevation','Worksheet','3DDocument']},
    story_index:{type:'integer',description:'Only for window_type=FloorPlan.'},
    fit:{type:'boolean',description:'Fit the given element_ids, or everything when no IDs are supplied. Default false.'},
    element_ids:ids('Elements to frame, only with fit=true.'),entire_drawing:{type:'boolean',description:'Export the entire 2D drawing instead of its zoom; default false.'},
    restore_view:{type:'boolean'},show_to_user:{type:'boolean'},caption:string('Factual caption in the user language; do not claim visual verification before inspecting the image.')
  }),
  fn('inspect_elements','Read a selected, typed, explicit or whole-model set in bounded batches. Saves complete element details/properties/quantities locally and returns a compact summary. Preserves API errors, checks response cardinality, and reports truncation. Default scope is the current selection. Do not use as a replacement for actual Interactive Schedule cells.',{
    selection:{type:'string',enum:['selected','all'],description:'Default selected. Do not combine with element_type or element_ids.'},
    element_type:string('Exact public Archicad type. Mutually exclusive with selection and element_ids.'),element_ids:ids('Explicit element GUIDs; mutually exclusive with selection and element_type.'),
    filters:{type:'array',minItems:1,items:{type:'string'},description:'Documented filters for an element_type query.'},
    fields:{type:'array',minItems:1,items:{type:'string',enum:['type','id','floorIndex','layerIndex','drawIndex','details','floorPlanPolygons','hotlinkId']},description:'Default excludes expensive floorPlanPolygons.'},
    property_ids:ids('Property GUIDs to read for each element.'),quantities:{type:'boolean'},
    batch_size:{type:'integer',minimum:1,maximum:250,description:'Default 100.'},limit:{type:'integer',minimum:1,maximum:50000,description:'Default 1000. Larger selections are explicitly marked partial.'}
  }),
  fn('export_layout_package','Inventory every layout and publisher set, or export explicitly selected existing PDF sets and check the resulting PDFs against the complete layout registry. Default action=plan does not publish. Export requires publisher_set_names and review/full mode; it never edits publisher settings or saves the PLN. Returns missing/ambiguous pages and separate text/visual coverage. Use instead of writing a layout export script.',{
    action:{type:'string',enum:['plan','export']},publisher_set_names:{type:'array',minItems:1,maxItems:50,items:{type:'string',minLength:1},description:'Exact existing sets configured to produce PDF files. Never guess format from the name.'},
    render_pages:{type:'array',maxItems:20,items:{type:'integer',minimum:1},description:'Optional 1-based PDF page numbers for local previews.'},max_pages:{type:'integer',minimum:1,maximum:5000}
  }),
  fn('audit_layout_text','Audit local PDF text with offline Russian/English dictionaries, coordinates, mixed scripts, repeated words, a glossary and explicit preferred terms. Produces JSON and Markdown from one findings list. No model or PDF edits. Dictionary misses are review candidates, not confirmed errors. Image text/visual review have separate coverage. Optional OCR uses bundled Russian/English Tesseract data locally; unavailable or uncertain OCR is reported separately and never counted as visual review.',{
    files:{type:'array',minItems:1,maxItems:200,items:string('Exact PDF path from file listing/export; session-relative or project:/path.')},
    languages:{type:'array',minItems:1,maxItems:2,uniqueItems:true,items:{type:'string',enum:['ru','en']}},spellcheck:{type:'boolean'},ocr:{type:'boolean'},
    glossary:{type:'array',maxItems:10000,items:{type:'string',minLength:1,maxLength:100}},
    replacements:{type:'array',maxItems:200,items:{type:'object',properties:{from:{type:'string',minLength:1,maxLength:200},to:{type:'string',maxLength:200}},required:['from','to'],additionalProperties:false}},
    render_pages:{type:'array',maxItems:20,items:{type:'integer',minimum:1}},max_pages:{type:'integer',minimum:1,maximum:5000},max_findings:{type:'integer',minimum:1,maximum:20000}
  },['files']),
  fn('apply_change_plan','Preview or apply a saved plan of absolute element detail/property assignments. Preview reads all baselines without writes and returns a plan_id with before/after values. Apply accepts only that ID, checks the project and all baselines, follows the current permission mode, checkpoints each write and verifies by readback. Repeated apply skips values already matching; unknown outcomes are never blindly replayed. No creation/deletion, GDL scripts, relative moves, rollback or PLN save. Use exact live SetDetailsOfElements/SetPropertyValuesOfElements schemas. Only fields readable through the corresponding Get command are supported; property values use Tapir display strings.',{
    action:{type:'string',enum:['preview','apply']},plan_id:string('Exact immutable ID returned by preview; apply only.'),purpose:string('Concrete change explanation in the user language; stored with the preview.'),
    changes:{type:'array',minItems:1,maxItems:500,description:'Preview only. Combine detail assignments for one element into one entry.',items:{type:'object',properties:{kind:{type:'string',enum:['details','property']},element_id:ids('').items,property_id:ids('').items,after:{oneOf:[{type:'object',minProperties:1,description:'Exact SetDetailsOfElements details, including typeSpecificDetails when supported.'},{type:'string',description:'Exact Tapir property display string.'}]}},required:['kind','element_id','after'],additionalProperties:false}}
  })
];

export const operationToolNames=operationTools.map(tool=>tool.function.name);

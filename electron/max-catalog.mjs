// Public operation names used for schema discovery, permissions and anonymous workflow cards.
export const maxReadCommands=['query_scene','inspect_object','get_hierarchy','get_materials','geometry_qa','contact_check','capture_viewport','get_bridge_status'];
export const maxWriteCommands=['create_object','transform_object','assign_material','add_modifier','mesh_edit','render_setup','undo_last','run_python'];
export const maxCommands=[...maxReadCommands,...maxWriteCommands];
export const maxMcpVersion='2.0.1';
export const maxBridgeVersion=year=>year===2022?'1.1.0':maxMcpVersion;
export const maxYear=value=>Number.isInteger(value)&&value>=2022&&value<=2027?value:undefined;

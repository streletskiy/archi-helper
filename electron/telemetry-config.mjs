// The bundle receives only public ingestion settings from private build configuration.
// Administrative credentials, project IDs and dashboard addresses never belong here.
const deployment=typeof __ARCHI_TELEMETRY_CONFIG__==='undefined'?{}:__ARCHI_TELEMETRY_CONFIG__;
export const TELEMETRY_CONFIG=Object.freeze({host:'https://eu.i.posthog.com',projectToken:'',...deployment,schemaVersion:2});

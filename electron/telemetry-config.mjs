// Deployment settings are supplied outside Git. Never embed administrative credentials.
export const TELEMETRY_CONFIG=Object.freeze({
  host:process.env.ARCHI_POSTHOG_HOST||'https://eu.i.posthog.com',
  projectToken:process.env.ARCHI_POSTHOG_PROJECT_TOKEN||'',
  schemaVersion:1,
});

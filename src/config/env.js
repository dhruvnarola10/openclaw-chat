// Compile-time environment values. VITE_* keys are baked into the bundle
// at build time; runtime overrides are stored in localStorage by useConfig.

export const ENV = {
  apiUrl:   import.meta.env.VITE_API_URL      || '/api/responses',
  token:    import.meta.env.VITE_BEARER_TOKEN || '',
  agentId:  import.meta.env.VITE_AGENT_ID     || 'main',
  model:    import.meta.env.VITE_MODEL        || 'openclaw',
  stream:   import.meta.env.VITE_STREAM !== 'false',
  appToken: import.meta.env.VITE_APP_TOKEN    || '',
};

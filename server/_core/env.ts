export const ENV = {
  // Falls back to a stable app identifier so session JWTs always carry a
  // non-empty appId (required by verifySession) even when VITE_APP_ID is unset
  // in self-hosted / non-Manus deployments.
  appId: process.env.VITE_APP_ID || "estatetour-ai",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  // Supabase Postgres and Storage use separate endpoints/credentials. Never
  // expose the service-role key to Vite/client code.
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  supabaseStorageBucket:
    process.env.SUPABASE_STORAGE_BUCKET || "property-media",
  // AI provider credentials are server-only. Model IDs are configurable so a
  // deployment can upgrade deliberately without changing application code.
  inworldApiKey: process.env.INWORLD_API_KEY ?? "",
  inworldVisionModel:
    process.env.INWORLD_VISION_MODEL || "anthropic/claude-sonnet-4-6",
  // Official Kling 3.0 video generation. The API base defaults to the
  // documented Singapore region and can be overridden for another official
  // regional endpoint.
  klingApiKey: process.env.KLING_API_KEY ?? "",
  klingApiBaseUrl:
    process.env.KLING_API_BASE_URL || "https://api-singapore.klingai.com",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};

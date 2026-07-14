export const ENV = {
  // Falls back to a stable app identifier so session JWTs always carry a
  // non-empty appId (required by verifySession) even when VITE_APP_ID is unset
  // in self-hosted / non-Manus deployments.
  appId: process.env.VITE_APP_ID || "estatetour-ai",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};

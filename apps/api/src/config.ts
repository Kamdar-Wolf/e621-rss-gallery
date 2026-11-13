import process from "node:process";
export const config = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || "postgresql://reader:reader@localhost:5432/reader",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  publicOrigin: process.env.PUBLIC_ORIGIN || "http://localhost:5173",
  secureCookies: process.env.COOKIE_SECURE === "true",
  bootstrapToken: process.env.BOOTSTRAP_TOKEN || "",
  fetchMinIntervalMs: Math.max(1100, Number(process.env.FETCH_MIN_INTERVAL_MS || 2100)),
  nodeEnv: process.env.NODE_ENV || "development",
};
if (config.nodeEnv === "production" && (!process.env.DATABASE_URL || !config.bootstrapToken || !config.secureCookies)) {
  throw new Error("Production requires DATABASE_URL, BOOTSTRAP_TOKEN and COOKIE_SECURE=true. Use HTTPS.");
}

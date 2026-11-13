import pg from "pg";
import { config } from "./config.js";
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 15,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
pool.on("error", (error: Error) => console.error("Postgres idle connection error", error.message));
export type DBClient = pg.PoolClient;

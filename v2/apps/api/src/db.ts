import pg from "pg";

export function connectPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 8,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    query_timeout: 10000
  });
}

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// prepare:false — required for Neon: its pooler (and compute auto-suspend/resume) can drop the
// connection mid-session, and cached prepared statements don't survive the reconnect. Simple
// (unnamed) queries reconnect cleanly. Safe and transparent on local Postgres too.
const sql = postgres(process.env.DATABASE_URL!, { max: 5, prepare: false });
export const db = drizzle(sql);
export const rawSql = sql;

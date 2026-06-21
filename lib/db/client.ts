import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 5 });
export const db = drizzle(sql);
export const rawSql = sql;

import mysql from "mysql2/promise";
import { config } from "./config.js";

let pool: mysql.Pool | null = null;

/** 获取连接池单例；未配置 DATABASE_URL 时抛错 */
export function getPool(): mysql.Pool {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL 未配置");
  }
  if (!pool) {
    pool = mysql.createPool({
      uri: config.databaseUrl,
      connectionLimit: 10,
      timezone: "+00:00",
      supportBigNumbers: true,
    });
  }
  return pool;
}

export async function pingDb(): Promise<boolean> {
  try {
    const conn = await getPool().getConnection();
    await conn.ping();
    conn.release();
    return true;
  } catch {
    return false;
  }
}

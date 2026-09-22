import { expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { getPool } from "../../src/db.ts";

type InjectResponse = Awaited<ReturnType<FastifyInstance["inject"]>>;

export async function resetDb() {
  const pool = getPool();
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");
  await pool.query("TRUNCATE TABLE accounts");
  await pool.query("TRUNCATE TABLE characters");
  await pool.query("TRUNCATE TABLE chat_messages");
  await pool.query("TRUNCATE TABLE battles");
  await pool.query("TRUNCATE TABLE map_node_monsters");
  // 战斗胜利会写斩杀统计，角色 id 每轮重建后固定为小值，必须清掉跨 run 残留
  await pool.query("TRUNCATE TABLE character_monster_stats");
  // 背包/装备位（切片 5）：战斗结算会写掉落入包与耐久损耗，同样不能跨 run 残留
  await pool.query("TRUNCATE TABLE character_inventory");
  await pool.query("TRUNCATE TABLE character_equipment");
  await pool.query("SET FOREIGN_KEY_CHECKS = 1");
}

/** 从 inject 响应取第一个 cookie 的 "name=value" */
export function cookieOf(res: InjectResponse): string {
  const set = res.headers["set-cookie"];
  const first = Array.isArray(set) ? set[0] : set;
  return first?.split(";")[0] ?? "";
}

/** 注册一个新账号并返回其 cookie */
export async function registerAndLogin(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { username, password: "secret123" },
  });
  expect(res.statusCode).toBe(201);
  return cookieOf(res);
}

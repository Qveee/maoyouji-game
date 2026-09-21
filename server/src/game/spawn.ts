/**
 * 每格怪物实例的惰性刷怪/复活（切片 4 Task 5）。
 *
 * 服务器零定时器：不靠时间到主动触发，而是在「进入格子（POST /move 落点）」与
 * 「查看地图（GET /map/current）」时惰性结算——
 * - 无实例的带 spawns 格子 → 随机 2~4 只生成；
 * - 实例全部死亡的格子 → 其中 respawn_at <= NOW() 的尸体复活（未到 30s 的保持尸体）；
 * - 仍有活怪的格子 → 保持现状（既不补怪也不复活）。
 * 刷怪/复活不在战斗结算路径上，无确定性要求，直接用 Math.random。
 */

import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getPool } from "../db.ts";
import { mapIndex, monsterIndex } from "../data/loader.ts";

/** [min, max] 闭区间随机整数 */
function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** 一格随机刷 2~4 只：类型从 spawns 配置的怪物池均匀随机，HP 在静态区间内随机 */
async function insertFreshSpawns(mapCode: string, nodeCode: string, spawns: string[]): Promise<void> {
  const count = randInt(2, 4);
  const values: Array<[string, string, string, number, number, string]> = [];
  for (let i = 0; i < count; i++) {
    const code = spawns[randInt(0, spawns.length - 1)]!; // spawns 非空由调用方保证
    const monster = monsterIndex().get(code)!; // validateCrossRefs 已保证引用存在
    values.push([mapCode, nodeCode, code, randInt(monster.hpMin, monster.hpMax), monster.hpMax, "alive"]);
  }
  await getPool().query<ResultSetHeader>(
    "INSERT INTO map_node_monsters (map_code, node_code, monster_code, hp, max_hp, status) VALUES ?",
    [values],
  );
}

/** 把一批到期尸体复活：status='alive'、HP 按静态区间重新 roll（即回满新血量）、respawn_at 清空 */
async function reviveRows(rows: RowDataPacket[]): Promise<void> {
  for (const row of rows) {
    const monster = monsterIndex().get(row.monster_code as string)!;
    await getPool().query(
      "UPDATE map_node_monsters SET status = 'alive', hp = ?, respawn_at = NULL WHERE id = ?",
      [randInt(monster.hpMin, monster.hpMax), row.id],
    );
  }
}

/**
 * 进入/查看格子时的惰性刷怪（幂等，可重复调用）：
 * - 格子无 spawns 配置 → 直接返回（城镇全部节点与 my_rukou/my_wanma/my_aolin 永不刷怪）；
 * - 该格无任何实例 → 随机 2~4 只 INSERT；
 * - 该格实例全部死亡 → 复活其中 respawn_at <= NOW() 的尸体，未到期的保持尸体不动；
 * - 该格仍有活怪 → 保持现状。
 */
export async function spawnForNode(mapCode: string, nodeCode: string): Promise<void> {
  const spawns = mapIndex().get(mapCode)?.nodes.find((n) => n.code === nodeCode)?.spawns ?? [];
  if (spawns.length === 0) return;

  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT status FROM map_node_monsters WHERE map_code = ? AND node_code = ?",
    [mapCode, nodeCode],
  );
  if (rows.length === 0) {
    await insertFreshSpawns(mapCode, nodeCode, spawns);
    return;
  }
  if (rows.some((r) => r.status === "alive")) return; // 还有活怪：保持现状
  const [due] = await getPool().query<RowDataPacket[]>(
    `SELECT id, monster_code FROM map_node_monsters
     WHERE map_code = ? AND node_code = ? AND status = 'dead' AND respawn_at <= NOW()`,
    [mapCode, nodeCode],
  );
  await reviveRows(due);
}

/**
 * 整图惰性复活扫描（GET /map/current 响应前调用）：
 * 把该图所有 respawn_at <= NOW() 的死亡实例复活，与所在格子无关。
 */
export async function reviveDueMonsters(mapCode: string): Promise<void> {
  const [due] = await getPool().query<RowDataPacket[]>(
    `SELECT id, monster_code FROM map_node_monsters
     WHERE map_code = ? AND status = 'dead' AND respawn_at <= NOW()`,
    [mapCode],
  );
  await reviveRows(due);
}

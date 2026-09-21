/**
 * 角色当前格解析与出生点兜底（地图路由与战斗路由共享）。
 * 空值或静态数据里已不存在的残留节点码，惰性落库猫隐村出生点；
 * 连接由调用方注入（地图路由传连接池，战斗开战传事务连接），兜底 UPDATE 与调用方同事务可见。
 */
import type { Pool, PoolConnection } from "mysql2/promise";
import { mapIndex, nodeIndex } from "../data/loader.ts";

const VILLAGE_CODE = "maoyin_village";

/** 可执行 SQL 的连接：mysql2 promise 连接池或事务连接 */
export type Queryable = Pool | PoolConnection;

/**
 * 解析角色当前格代码并返回；兜底写库时带 deleted_at 守卫
 * （两处调用方的角色行都刚按未软删查出/锁定，守卫只是双保险，不改变行为）。
 * 角色行是否存在由调用方负责。
 */
export async function resolveCurrentNode(
  conn: Queryable,
  characterId: number,
  curCode: string | null | undefined,
): Promise<string> {
  let code = curCode ?? "";
  if (!code || !nodeIndex().has(code)) {
    code = mapIndex().get(VILLAGE_CODE)!.spawnNodeCode;
    await conn.query(
      "UPDATE characters SET current_node_code = ? WHERE id = ? AND deleted_at IS NULL",
      [code, characterId],
    );
  }
  return code;
}

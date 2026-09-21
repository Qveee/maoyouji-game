import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getPool } from "../db.ts";
import { mapIndex, monsterIndex, nodeIndex } from "../data/loader.ts";
import { requireCharacter } from "../plugins/auth.ts";
import { reviveDueMonsters, spawnForNode } from "../game/spawn.ts";

const VILLAGE_CODE = "maoyin_village";

/**
 * 查角色当前所在节点，并经 nodeIndex 反查所属地图（支持双图）。
 * 旧角色（出生点功能上线前创建）或残留的未知节点：惰性落库猫隐村出生点。
 */
async function currentOf(characterId: number): Promise<{ mapCode: string; nodeCode: string }> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT current_node_code FROM characters WHERE id = ? AND deleted_at IS NULL",
    [characterId],
  );
  let code = (rows[0]?.current_node_code as string | null) ?? "";
  if (!code || !nodeIndex().has(code)) {
    code = mapIndex().get(VILLAGE_CODE)!.spawnNodeCode;
    await getPool().query("UPDATE characters SET current_node_code = ? WHERE id = ?", [
      code,
      characterId,
    ]);
  }
  return { mapCode: nodeIndex().get(code)!.mapCode, nodeCode: code };
}

/**
 * 组装地图视图（GET /map/current 与跨图移动响应共用同一结构）。
 * field 图节点附带 monsters（仅 alive，静态 name/level/sprite 取自 monsters.json）；
 * 城镇不刷怪，节点不带 monsters 字段。
 */
async function buildMapView(mapCode: string, currentNodeCode: string) {
  const map = mapIndex().get(mapCode)!;
  // 按格聚合该图活怪实例
  const aliveByNode = new Map<string, Array<{ id: number; code: string; name: string; hp: number; maxHp: number; level: number; sprite: string }>>();
  if (map.type === "field") {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT id, node_code, monster_code, hp, max_hp FROM map_node_monsters
       WHERE map_code = ? AND status = 'alive'`,
      [mapCode],
    );
    for (const r of rows) {
      const monster = monsterIndex().get(r.monster_code as string)!;
      const nodeCode = r.node_code as string;
      const list = aliveByNode.get(nodeCode) ?? [];
      list.push({
        id: r.id as number,
        code: r.monster_code as string,
        name: monster.name,
        hp: r.hp as number,
        maxHp: r.max_hp as number,
        level: monster.level,
        sprite: monster.sprite,
      });
      aliveByNode.set(nodeCode, list);
    }
  }
  return {
    map: { code: map.code, name: map.name, type: map.type, background: map.background },
    currentNodeCode,
    nodes: map.nodes.map((n) => {
      const base = {
        code: n.code,
        name: n.name,
        short: n.short,
        x: n.x,
        y: n.y,
        locked: n.locked ?? false,
        lockedReason: n.lockedReason ?? null,
        npcs: n.npcs,
      };
      return map.type === "field" ? { ...base, monsters: aliveByNode.get(n.code) ?? [] } : base;
    }),
  };
}

/** 节点简要信息（同图移动的响应体） */
function nodeBrief(code: string) {
  const n = nodeIndex().get(code)!.node;
  return { code: n.code, name: n.name, short: n.short };
}

/** 当前地图视图：节点、NPC、我的位置 */
export async function mapRoutes(app: FastifyInstance) {
  app.get("/current", { preHandler: requireCharacter }, async (req) => {
    const cur = await currentOf(req.account!.characterId!);
    const map = mapIndex().get(cur.mapCode)!;
    if (map.type === "field") {
      await reviveDueMonsters(cur.mapCode); // 响应前对全图做一次惰性复活扫描
      await spawnForNode(cur.mapCode, cur.nodeCode); // 查看当前格：无实例则刷怪
    }
    return buildMapView(cur.mapCode, cur.nodeCode);
  });

  app.post("/move", { preHandler: requireCharacter }, async (req, reply) => {
    const body = z.object({ toCode: z.string().min(1).max(64) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ message: "参数不合法" });

    // 战斗中禁止移动（直接 EXISTS 查 battles，不依赖战斗模块）
    const [busy] = await getPool().query<RowDataPacket[]>(
      "SELECT EXISTS(SELECT 1 FROM battles WHERE character_id = ? AND status = 'active') AS busy",
      [req.account!.characterId],
    );
    if (busy[0]?.busy) return reply.code(409).send({ message: "战斗中无法移动" });

    const target = nodeIndex().get(body.data.toCode);
    if (!target) return reply.code(404).send({ message: "地点不存在" });
    if (target.node.locked) {
      return reply.code(400).send({ message: target.node.lockedReason ?? "该地点暂未开放" });
    }

    const cur = await currentOf(req.account!.characterId!);
    const curMap = mapIndex().get(cur.mapCode)!;

    // 站在原地再点原地（含站在出口节点上再点它，防跨图弹回）：no-op，返回现状
    if (body.data.toCode === cur.nodeCode) {
      return { node: nodeBrief(target.node.code) };
    }

    // 可达性：城镇图内自由移动；野外图内必须与当前格相邻；跨图只认出口——
    // 城镇任意位置可点出口，野外必须与当前格相邻
    const adjacent = nodeIndex().get(cur.nodeCode)!.node.adjacent ?? [];
    const reachable = target.node.exit
      ? curMap.type === "town" || adjacent.includes(target.node.code)
      : target.mapCode === cur.mapCode
        ? curMap.type === "town" || adjacent.includes(target.node.code)
        : false; // 其他地图的普通节点：UI 不可触达，防御性拒绝
    if (!reachable) return reply.code(400).send({ message: "目的地不可直达" });

    // 跨图出口（传送门语义）：直接落至出口指向的节点，从不站立在边界/出口节点上
    const landingNodeCode = target.node.exit ? target.node.exit.node : target.node.code;

    const [result] = await getPool().query<ResultSetHeader>(
      "UPDATE characters SET current_node_code = ? WHERE id = ? AND deleted_at IS NULL",
      [landingNodeCode, req.account!.characterId],
    );
    if (result.affectedRows === 0) return reply.code(404).send({ message: "角色不存在" });

    // 进入格子惰性刷怪（落点无 spawns 配置时内部直接返回）
    const landingMapCode = target.node.exit ? target.node.exit.map : cur.mapCode;
    await spawnForNode(landingMapCode, landingNodeCode);

    if (target.node.exit) {
      // 跨图成功：返回新地图视图（同 /map/current 结构，含惰性复活扫描）
      await reviveDueMonsters(landingMapCode);
      return buildMapView(landingMapCode, landingNodeCode);
    }
    return { node: nodeBrief(target.node.code) };
  });
}

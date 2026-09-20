import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getPool } from "../db.ts";
import { mapIndex } from "../data/loader.ts";
import { requireCharacter } from "../plugins/auth.ts";

const VILLAGE_CODE = "maoyin_village";

/** 当前地图视图：节点、NPC、我的位置 */
export async function mapRoutes(app: FastifyInstance) {
  app.get("/current", { preHandler: requireCharacter }, async (req) => {
    const [rows] = await getPool().query<RowDataPacket[]>(
      "SELECT current_node_code FROM characters WHERE id = ? AND deleted_at IS NULL",
      [req.account!.characterId],
    );
    const current = rows[0]?.current_node_code as string | null;
    const map = mapIndex().get(VILLAGE_CODE)!;
    return {
      map: { code: map.code, name: map.name, type: map.type, background: map.background },
      currentNodeCode: current,
      nodes: map.nodes.map((n) => ({
        code: n.code,
        name: n.name,
        short: n.short,
        x: n.x,
        y: n.y,
        locked: n.locked ?? false,
        lockedReason: n.lockedReason ?? null,
        npcs: n.npcs,
      })),
    };
  });

  app.post("/move", { preHandler: requireCharacter }, async (req, reply) => {
    const body = z.object({ toCode: z.string().min(1).max(64) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ message: "参数不合法" });
    const node = mapIndex().get(VILLAGE_CODE)!.nodes.find((n) => n.code === body.data.toCode);
    if (!node) return reply.code(404).send({ message: "地点不存在" });
    if (node.locked) return reply.code(400).send({ message: node.lockedReason ?? "该地点暂未开放" });

    const [result] = await getPool().query<ResultSetHeader>(
      "UPDATE characters SET current_node_code = ? WHERE id = ? AND deleted_at IS NULL",
      [node.code, req.account!.characterId],
    );
    if (result.affectedRows === 0) return reply.code(404).send({ message: "角色不存在" });
    return { node: { code: node.code, name: node.name, short: node.short } };
  });
}

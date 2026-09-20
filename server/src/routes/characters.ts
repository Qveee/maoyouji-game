import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getPool } from "../db.ts";
import { petIndex } from "../data/loader.ts";
import { mapIndex } from "../data/loader.ts";
import { requireAccount } from "../plugins/auth.ts";

const createSchema = z.object({
  name: z.string().trim().min(2).max(16),
  breedCode: z.string().min(1),
  profession: z.enum(["warrior", "mage"]),
});

const SELECT_FIELDS =
  "id, name, profession, breed_code AS breedCode, level, exp, vit, str, agi, intel, spr, hp, sp, current_node_code AS currentNodeCode";

interface CharacterRow extends RowDataPacket {
  id: number;
  name: string;
  profession: "warrior" | "mage";
  breedCode: string;
  level: number;
  exp: number;
  vit: number;
  str: number;
  agi: number;
  intel: number;
  spr: number;
  hp: number;
  sp: number;
  currentNodeCode: string | null;
}

export async function characterRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: requireAccount }, async (req) => {
    const [rows] = await getPool().query<CharacterRow[]>(
      `SELECT ${SELECT_FIELDS} FROM characters WHERE account_id = ? AND deleted_at IS NULL ORDER BY id`,
      [req.account!.accountId],
    );
    return { characters: rows };
  });

  app.post("/", { preHandler: requireAccount }, async (req, reply) => {
    const body = createSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ message: "参数不合法" });
    const { name, breedCode, profession } = body.data;
    const pet = petIndex().get(breedCode);
    if (!pet) return reply.code(400).send({ message: "未知宠物" });

    const pool = getPool();
    const [countRows] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM characters WHERE account_id = ? AND deleted_at IS NULL",
      [req.account!.accountId],
    );
    if (Number(countRows[0]?.n) >= 5) {
      return reply.code(400).send({ message: "每个账号最多 5 个角色" });
    }

    const { vit, str, agi, intel, spr } = pet.baseStats;
    const level = 1;
    const hp = 50 + vit * 8 + level * 10;
    const sp = 30 + intel * 5 + level * 5;
    try {
      const [result] = await pool.query<ResultSetHeader>(
        `INSERT INTO characters (account_id, name, profession, breed_code, vit, str, agi, intel, spr, hp, sp, current_node_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.account!.accountId, name, profession, breedCode, vit, str, agi, intel, spr, hp, sp,
         mapIndex().get("maoyin_village")!.spawnNodeCode],
      );
      const [rows] = await pool.query<CharacterRow[]>(
        `SELECT ${SELECT_FIELDS} FROM characters WHERE id = ?`,
        [result.insertId],
      );
      return reply.code(201).send(rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
        return reply.code(409).send({ message: "角色名已存在" });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>("/:id", { preHandler: requireAccount }, async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ message: "参数不合法" });
    const [result] = await getPool().query<ResultSetHeader>(
      `UPDATE characters SET deleted_at = CURRENT_TIMESTAMP,
         name = CONCAT('#', id, '#', name)
       WHERE id = ? AND account_id = ? AND deleted_at IS NULL`,
      [id, req.account!.accountId],
    );
    if (result.affectedRows === 0) return reply.code(404).send({ message: "角色不存在" });
    return reply.send({ ok: true });
  });
}

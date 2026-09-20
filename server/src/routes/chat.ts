import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getPool } from "../db.ts";
import { requireCharacter } from "../plugins/auth.ts";

/** guild/team 枚举与可见性分支预留，暂不开放发送 */
const OPEN_CHANNELS = new Set(["area", "world", "private"]);
const WORLD_LIMIT_MS = 10_000;
const HISTORY_LIMIT = 50;

interface ChatRow extends RowDataPacket {
  id: number;
  channel: "area" | "world" | "private" | "guild" | "team";
  sender_id: number;
  sender_name: string;
  target_id: number | null;
  target_name: string | null;
  node_code: string | null;
  content: string;
  created_at: Date;
}

/** 行 → API 消息（createdAt 输出 ISO UTC，前端转本地时间展示） */
function toMessage(row: ChatRow) {
  return {
    id: row.id,
    channel: row.channel,
    senderId: row.sender_id,
    senderName: row.sender_name,
    targetName: row.target_name,
    nodeCode: row.node_code,
    content: row.content,
    createdAt: row.created_at.toISOString(),
  };
}

/** 当前聊天路由 */
export async function chatRoutes(app: FastifyInstance) {
  app.get("/messages", { preHandler: requireCharacter }, async (req) => {
    const characterId = req.account!.characterId!;
    const pool = getPool();
    const [meRows] = await pool.query<RowDataPacket[]>(
      "SELECT current_node_code FROM characters WHERE id = ? AND deleted_at IS NULL",
      [characterId],
    );
    // 无格子的角色给一个永不等值哨兵（node_code = NULL 等值比较本就永假，哨兵仅为可读性）
    const nodeCode = (meRows[0]?.current_node_code as string | null) ?? "__nowhere__";

    const sinceId = Number((req.query as { sinceId?: string }).sinceId ?? 0);
    // 可见性：world 全员；area 同格；private 收发双方（guild/team 预留永假）
    const visibility = `channel = 'world'
      OR (channel = 'area' AND node_code = ?)
      OR (channel = 'private' AND (sender_id = ? OR target_id = ?))`;
    const visParams = [nodeCode, characterId, characterId];

    let rows: ChatRow[];
    if (Number.isFinite(sinceId) && sinceId > 0) {
      [rows] = await pool.query<ChatRow[]>(
        `SELECT * FROM chat_messages WHERE id > ? AND (${visibility}) ORDER BY id ASC LIMIT 200`,
        [sinceId, ...visParams],
      );
    } else {
      // 首拉：对我可见的最新 50 条，正序输出
      [rows] = await pool.query<ChatRow[]>(
        `SELECT * FROM (SELECT * FROM chat_messages WHERE (${visibility}) ORDER BY id DESC LIMIT ?) t ORDER BY id ASC`,
        [...visParams, HISTORY_LIMIT],
      );
    }
    return { messages: rows.map(toMessage) };
  });

  app.post("/send", { preHandler: requireCharacter }, async (req, reply) => {
    const body = z
      .object({
        channel: z.enum(["area", "world", "private", "guild", "team"]),
        content: z.string().trim().min(1).max(60),
        targetName: z.string().trim().min(1).max(32).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ message: "参数不合法" });
    const { channel, content } = body.data;
    if (!OPEN_CHANNELS.has(channel)) return reply.code(400).send({ message: "该频道暂未开放" });

    const characterId = req.account!.characterId!;
    const pool = getPool();
    const [meRows] = await pool.query<RowDataPacket[]>(
      "SELECT id, name, current_node_code FROM characters WHERE id = ? AND deleted_at IS NULL",
      [characterId],
    );
    const me = meRows[0] as { id: number; name: string; current_node_code: string | null } | undefined;
    if (!me) return reply.code(404).send({ message: "角色不存在" });

    let targetId: number | null = null;
    let targetName: string | null = null;
    let nodeCode: string | null = null;

    if (channel === "private") {
      if (!body.data.targetName) return reply.code(400).send({ message: "请填写私聊目标" });
      const [tRows] = await pool.query<RowDataPacket[]>(
        "SELECT id, name FROM characters WHERE name = ? AND deleted_at IS NULL",
        [body.data.targetName],
      );
      const target = tRows[0] as { id: number; name: string } | undefined;
      if (!target) return reply.code(404).send({ message: "角色不存在" });
      if (target.id === me.id) return reply.code(400).send({ message: "不能私聊自己" });
      targetId = target.id;
      targetName = target.name;
    } else if (channel === "area") {
      nodeCode = me.current_node_code;
      if (!nodeCode) return reply.code(400).send({ message: "尚未进入地图" });
    } else if (channel === "world") {
      // 惰性限频：查我上一条世界消息，不足 10 秒拒绝（无服务器定时器）
      const [last] = await pool.query<RowDataPacket[]>(
        "SELECT created_at FROM chat_messages WHERE sender_id = ? AND channel = 'world' ORDER BY id DESC LIMIT 1",
        [me.id],
      );
      const lastAt = last[0] ? new Date((last[0] as { created_at: Date }).created_at).getTime() : 0;
      if (Date.now() - lastAt < WORLD_LIMIT_MS) {
        return reply.code(400).send({ message: "世界频道每10秒只能发言一次" });
      }
      // 顺带惰性清理一天前旧消息
      await pool.query("DELETE FROM chat_messages WHERE created_at < (NOW() - INTERVAL 1 DAY)");
    }

    const [result] = await pool.query<ResultSetHeader>(
      "INSERT INTO chat_messages (channel, sender_id, sender_name, target_id, target_name, node_code, content) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [channel, me.id, me.name, targetId, targetName, nodeCode, content],
    );
    return {
      message: {
        id: result.insertId,
        channel,
        senderId: me.id,
        senderName: me.name,
        targetName,
        nodeCode,
        content,
        createdAt: new Date().toISOString(),
      },
    };
  });
}

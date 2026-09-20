import type { FastifyInstance } from "fastify";
import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getPool } from "../db.ts";
import { config } from "../config.ts";
import { signJwt } from "../lib/jwt.ts";
import { COOKIE_NAME, requireAccount } from "../plugins/auth.ts";

const credentialsSchema = z.object({
  username: z.string().trim().min(2).max(32),
  password: z.string().min(6).max(128),
});

function setAuthCookie(reply: import("fastify").FastifyReply, accountId: number, characterId?: number) {
  const token = signJwt(
    { accountId, ...(characterId != null ? { characterId } : {}) },
    config.jwtSecret,
    config.jwtTtlSec,
  );
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: config.jwtTtlSec,
  });
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/register", async (req, reply) => {
    const body = credentialsSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ message: "参数不合法" });
    const { username, password } = body.data;
    const passwordHash = await hash(password);
    try {
      const [result] = await getPool().query<ResultSetHeader>(
        "INSERT INTO accounts (username, password_hash) VALUES (?, ?)",
        [username, passwordHash],
      );
      setAuthCookie(reply, Number(result.insertId));
      return reply.code(201).send({ username });
    } catch (err) {
      if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
        return reply.code(409).send({ message: "用户名已存在" });
      }
      throw err;
    }
  });

  app.post("/login", async (req, reply) => {
    const body = credentialsSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ message: "参数不合法" });
    const { username, password } = body.data;
    const [rows] = await getPool().query<RowDataPacket[]>(
      "SELECT id, password_hash FROM accounts WHERE username = ?",
      [username],
    );
    const row = rows[0];
    if (!row || !(await verify(row.password_hash as string, password))) {
      return reply.code(401).send({ message: "用户名或密码错误" });
    }
    await getPool().query("UPDATE accounts SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?", [row.id]);
    setAuthCookie(reply, Number(row.id));
    return reply.send({ username });
  });

  app.post("/logout", async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return reply.send({ ok: true });
  });

  app.get("/me", { preHandler: requireAccount }, async (req, reply) => {
    const { accountId, characterId } = req.account!;
    const [rows] = await getPool().query<RowDataPacket[]>(
      "SELECT username FROM accounts WHERE id = ?",
      [accountId],
    );
    if (!rows[0]) return reply.code(401).send({ message: "登录状态已失效，请重新登录" });
    return { username: rows[0]?.username, characterId };
  });

  app.post("/select-character", { preHandler: requireAccount }, async (req, reply) => {
    const body = z.object({ characterId: z.number().int().positive() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ message: "参数不合法" });
    const { accountId } = req.account!;
    const [rows] = await getPool().query<RowDataPacket[]>(
      "SELECT id FROM characters WHERE id = ? AND account_id = ? AND deleted_at IS NULL",
      [body.data.characterId, accountId],
    );
    if (!rows[0]) return reply.code(403).send({ message: "非本人角色" });
    setAuthCookie(reply, accountId, body.data.characterId);
    return reply.send({ characterId: body.data.characterId });
  });
}

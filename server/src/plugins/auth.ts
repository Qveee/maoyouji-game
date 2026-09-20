import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.ts";
import { verifyJwt } from "../lib/jwt.ts";

declare module "fastify" {
  interface FastifyRequest {
    account?: { accountId: number; characterId: number | null };
  }
}

export const COOKIE_NAME = "mj_token";

/** 受保护路由的 preHandler：解析 cookie 中的 JWT，失败 401 */
export async function requireAccount(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[COOKIE_NAME];
  const payload = token ? verifyJwt(token, config.jwtSecret) : null;
  if (!payload) {
    return reply.code(401).send({ message: "未登录" });
  }
  req.account = { accountId: payload.accountId, characterId: payload.characterId ?? null };
}

/** 已登录且已选角 */
export async function requireCharacter(req: FastifyRequest, reply: FastifyReply) {
  await requireAccount(req, reply);
  if (reply.sent) return;
  if (req.account?.characterId == null) {
    return reply.code(400).send({ message: "未选择角色" });
  }
}

import type { FastifyInstance } from "fastify";
import { loadPets } from "../data/loader.js";
import { requireAccount } from "../plugins/auth.js";

/** 可选宠物列表（静态数据，建角色用） */
export async function petsRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: requireAccount }, async () => {
    return { pets: loadPets().pets };
  });
}

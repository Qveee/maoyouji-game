import type { FastifyInstance } from "fastify";
import { pingDb } from "../db.js";

export async function healthRoute(app: FastifyInstance) {
  app.get("/health", async () => {
    let db: "connected" | "disconnected" | "not_configured" = "not_configured";
    if (process.env.DATABASE_URL) {
      db = (await pingDb()) ? "connected" : "disconnected";
    }
    return { status: "ok", db };
  });
}

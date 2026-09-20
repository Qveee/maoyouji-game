import Fastify, { type FastifyInstance } from "fastify";
import { healthRoute } from "./routes/health.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(healthRoute, { prefix: "/api" });
  return app;
}

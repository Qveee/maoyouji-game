import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { healthRoute } from "./routes/health.ts";
import { authRoutes } from "./routes/auth.ts";
import { characterRoutes } from "./routes/characters.ts";
import { petsRoutes } from "./routes/pets.ts";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(cookie);
  app.register(healthRoute, { prefix: "/api" });
  app.register(authRoutes, { prefix: "/api/auth" });
  app.register(characterRoutes, { prefix: "/api/characters" });
  app.register(petsRoutes, { prefix: "/api/pets" });
  return app;
}

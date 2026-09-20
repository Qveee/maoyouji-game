import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { healthRoute } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { characterRoutes } from "./routes/characters.js";
import { petsRoutes } from "./routes/pets.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(cookie);
  app.register(healthRoute, { prefix: "/api" });
  app.register(authRoutes, { prefix: "/api/auth" });
  app.register(characterRoutes, { prefix: "/api/characters" });
  app.register(petsRoutes, { prefix: "/api/pets" });
  return app;
}

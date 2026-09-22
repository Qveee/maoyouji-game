import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { healthRoute } from "./routes/health.ts";
import { authRoutes } from "./routes/auth.ts";
import { characterRoutes } from "./routes/characters.ts";
import { petsRoutes } from "./routes/pets.ts";
import { mapRoutes } from "./routes/map.ts";
import { battleRoutes } from "./routes/battle.ts";
import { inventoryRoutes } from "./routes/inventory.ts";
import { chatRoutes } from "./routes/chat.ts";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(cookie);
  app.register(healthRoute, { prefix: "/api" });
  app.register(authRoutes, { prefix: "/api/auth" });
  app.register(characterRoutes, { prefix: "/api/characters" });
  app.register(petsRoutes, { prefix: "/api/pets" });
  app.register(mapRoutes, { prefix: "/api/map" });
  app.register(battleRoutes, { prefix: "/api/battle" });
  app.register(inventoryRoutes, { prefix: "/api/inventory" });
  app.register(chatRoutes, { prefix: "/api/chat" });
  return app;
}

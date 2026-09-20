import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

// 健康检查单测不依赖数据库：屏蔽环境中的连接配置
delete process.env.DATABASE_URL;

describe("GET /api/health", () => {
  it("服务存活返回 ok", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", db: expect.any(String) });
    await app.close();
  });
});

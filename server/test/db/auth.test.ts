import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.ts";
import { resetDb, registerAndLogin, cookieOf } from "./helpers.ts";

const app = buildApp();

beforeAll(async () => {
  await resetDb();
});

afterAll(async () => {
  await app.close();
});

describe("认证", () => {
  it("注册成功返回 201 并设置登录 cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "miaomiao", password: "secret123" },
    });
    expect(res.statusCode).toBe(201);
    expect(cookieOf(res)).toMatch(/^mj_token=/);
  });

  it("重复用户名返回 409", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "miaomiao", password: "secret123" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("未登录访问 me 返回 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(res.statusCode).toBe(401);
  });

  it("错误密码登录返回 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "miaomiao", password: "wrong-password" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("登录后 me 返回用户名且未选角", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "miaomiao", password: "secret123" },
    });
    expect(login.statusCode).toBe(200);
    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: cookieOf(login) },
    });
    expect(me.json()).toEqual({ username: "miaomiao", characterId: null });
  });

  it("选择他人角色返回 403", async () => {
    const other = await registerAndLogin(app, "otheruser");
    const created = await app.inject({
      method: "POST",
      url: "/api/characters",
      headers: { cookie: other },
      payload: { name: "别人的猫", breedCode: "mao", profession: "warrior" },
    });
    const otherCharacterId = created.json().id;
    const mine = await registerAndLogin(app, "mineuser");
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/select-character",
      headers: { cookie: mine },
      payload: { characterId: otherCharacterId },
    });
    expect(res.statusCode).toBe(403);
  });
});

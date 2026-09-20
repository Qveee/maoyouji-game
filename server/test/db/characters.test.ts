import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.ts";
import { resetDb, registerAndLogin, cookieOf } from "./helpers.ts";

const app = buildApp();
let cookie = "";

beforeAll(async () => {
  await resetDb();
  cookie = await registerAndLogin(app, "catlover");
});

afterAll(async () => {
  await app.close();
});

function createCharacter(payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie },
    payload,
  });
}

describe("角色", () => {
  it("创建猫战士：初始属性按公式派生", async () => {
    const res = await createCharacter({ name: "大橘为重", breedCode: "mao", profession: "warrior" });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    // §3.3：HP=50+vit*8+level*10=50+40+10；SP=30+intel*5+level*5=30+25+5
    expect(body).toMatchObject({ name: "大橘为重", breedCode: "mao", profession: "warrior", level: 1, vit: 5, str: 5, agi: 5, intel: 5, spr: 5, hp: 100, sp: 60, currentNodeCode: "guangchang" });
  });

  it("未知宠物返回 400", async () => {
    const res = await createCharacter({ name: "小坏猫", breedCode: "nope", profession: "mage" });
    expect(res.statusCode).toBe(400);
  });

  it("重名角色返回 409", async () => {
    const res = await createCharacter({ name: "大橘为重", breedCode: "nianshou", profession: "mage" });
    expect(res.statusCode).toBe(409);
  });

  it("上限 5 个角色，第 6 个返回 400", async () => {
    for (const name of ["猫二", "猫三", "猫四", "猫五"]) {
      const res = await createCharacter({ name, breedCode: "yetu", profession: "warrior" });
      expect(res.statusCode).toBe(201);
    }
    const sixth = await createCharacter({ name: "猫六", breedCode: "baozi", profession: "mage" });
    expect(sixth.statusCode).toBe(400);
  });

  it("列表返回 5 个角色", async () => {
    const res = await app.inject({ method: "GET", url: "/api/characters", headers: { cookie } });
    expect(res.json().characters).toHaveLength(5);
  });

  it("选角后 me 返回 characterId", async () => {
    const list = await app.inject({ method: "GET", url: "/api/characters", headers: { cookie } });
    const first = list.json().characters[0];
    const select = await app.inject({
      method: "POST",
      url: "/api/auth/select-character",
      headers: { cookie },
      payload: { characterId: first.id },
    });
    expect(select.statusCode).toBe(200);
    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: cookieOf(select) },
    });
    expect(me.json().characterId).toBe(first.id);
  });

  it("软删释放昵称，列表减一", async () => {
    const list = await app.inject({ method: "GET", url: "/api/characters", headers: { cookie } });
    const victim = list.json().characters.find((c: { name: string }) => c.name === "猫五");
    const del = await app.inject({ method: "DELETE", url: `/api/characters/${victim.id}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: "/api/characters", headers: { cookie } });
    expect(after.json().characters).toHaveLength(4);
    const recreate = await createCharacter({ name: "猫五", breedCode: "zhuzhu", profession: "warrior" });
    expect(recreate.statusCode).toBe(201);
  });

  it("宠物列表返回 17 种", async () => {
    const res = await app.inject({ method: "GET", url: "/api/pets", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().pets).toHaveLength(17);
  });
});

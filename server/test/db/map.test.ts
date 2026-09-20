import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.ts";
import { resetDb, registerAndLogin, cookieOf } from "./helpers.ts";

const app = buildApp();
let cookie = "";
let charCookie = "";

beforeAll(async () => {
  await resetDb();
  cookie = await registerAndLogin(app, "mapwalker");
  const created = await app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie },
    payload: { name: "走路猫", breedCode: "mao", profession: "warrior" },
  });
  const select = await app.inject({
    method: "POST",
    url: "/api/auth/select-character",
    headers: { cookie },
    payload: { characterId: created.json().id },
  });
  charCookie = cookieOf(select);
});

afterAll(async () => {
  await app.close();
});

describe("地图与移动", () => {
  it("未选角访问地图返回 400", async () => {
    const res = await app.inject({ method: "GET", url: "/api/map/current", headers: { cookie } });
    expect(res.statusCode).toBe(400);
  });

  it("当前视图：出生在广场且含 20 节点与 NPC", async () => {
    const res = await app.inject({ method: "GET", url: "/api/map/current", headers: { cookie: charCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.map.code).toBe("maoyin_village");
    expect(body.currentNodeCode).toBe("guangchang");
    expect(body.nodes).toHaveLength(20);
    expect(body.nodes.find((n: { code: string }) => n.code === "cunzhangxiaowu").npcs[0].name).toBe("肥猫");
  });

  it("城市自由移动到村口成功", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/map/move",
      headers: { cookie: charCookie },
      payload: { toCode: "cunkou" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().node).toMatchObject({ code: "cunkou", name: "村口" });
    const cur = await app.inject({ method: "GET", url: "/api/map/current", headers: { cookie: charCookie } });
    expect(cur.json().currentNodeCode).toBe("cunkou");
  });

  it("移动到不存在地点返回 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/map/move",
      headers: { cookie: charCookie },
      payload: { toCode: "nonexistent" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("移动到锁定出口（牧野草原03）返回 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/map/move",
      headers: { cookie: charCookie },
      payload: { toCode: "muye03" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("下一切片");
  });
});

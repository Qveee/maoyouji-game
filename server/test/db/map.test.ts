import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { buildApp } from "../../src/app.ts";
import { getPool } from "../../src/db.ts";
import { resetDb, registerAndLogin, cookieOf } from "./helpers.ts";

const app = buildApp();
let cookie = "";
let charCookie = "";
let characterId = 0;

beforeAll(async () => {
  await resetDb();
  cookie = await registerAndLogin(app, "mapwalker");
  const created = await app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie },
    payload: { name: "走路猫", breedCode: "mao", profession: "warrior" },
  });
  characterId = created.json().id;
  const select = await app.inject({
    method: "POST",
    url: "/api/auth/select-character",
    headers: { cookie },
    payload: { characterId },
  });
  charCookie = cookieOf(select);
});

afterAll(async () => {
  await app.close();
});

/** 以已选角身份发起移动 */
function move(toCode: string) {
  return app.inject({
    method: "POST",
    url: "/api/map/move",
    headers: { cookie: charCookie },
    payload: { toCode },
  });
}

/** 查看当前地图视图 */
function current() {
  return app.inject({ method: "GET", url: "/api/map/current", headers: { cookie: charCookie } });
}

describe("地图与移动", () => {
  it("未选角访问地图返回 400", async () => {
    const res = await app.inject({ method: "GET", url: "/api/map/current", headers: { cookie } });
    expect(res.statusCode).toBe(400);
  });

  it("当前视图：出生在广场且含 20 节点与 NPC", async () => {
    const res = await current();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.map.code).toBe("maoyin_village");
    expect(body.currentNodeCode).toBe("guangchang");
    expect(body.nodes).toHaveLength(20);
    expect(body.nodes.find((n: { code: string }) => n.code === "cunzhangxiaowu").npcs[0].name).toBe("肥猫");
  });

  it("城市自由移动到村口成功", async () => {
    const res = await move("cunkou");
    expect(res.statusCode).toBe(200);
    expect(res.json().node).toMatchObject({ code: "cunkou", name: "村口" });
    const cur = await current();
    expect(cur.json().currentNodeCode).toBe("cunkou");
  });

  it("移动到不存在地点返回 404", async () => {
    const res = await move("nonexistent");
    expect(res.statusCode).toBe(404);
  });

  it("城镇任意位置点草原入口：跨图直接落在 my_rukou 并返回草原视图", async () => {
    const res = await move("muye03");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // 跨图成功：返回新地图视图（同 /map/current 结构），从不站立在边界/出口节点上
    expect(body.map).toMatchObject({ code: "muye_caoyuan", name: "牧野草原", type: "field" });
    expect(body.currentNodeCode).toBe("my_rukou");
    expect(body.nodes).toHaveLength(38);
    expect(body.nodes.find((n: { code: string }) => n.code === "my_rukou")).toBeTruthy();
  });

  it("站在出口节点 my_rukou 上再点它是 no-op（防弹回）", async () => {
    const res = await move("my_rukou");
    expect(res.statusCode).toBe(200);
    const cur = await current();
    expect(cur.json().map.code).toBe("muye_caoyuan");
    expect(cur.json().currentNodeCode).toBe("my_rukou");
  });

  it("野外非相邻移动返回 400", async () => {
    // my_rukou 只与 my03 相邻
    const res = await move("my00");
    expect(res.statusCode).toBe(400);
    expect(typeof res.json().message).toBe("string");
    expect(res.json().message.length).toBeGreaterThan(0);
  });

  it("野外相邻移动通过", async () => {
    const res = await move("my03");
    expect(res.statusCode).toBe(200);
    expect(res.json().node).toMatchObject({ code: "my03", name: "牧野草原03" });
    const cur = await current();
    expect(cur.json().currentNodeCode).toBe("my03");
  });

  it("返程：草原相邻格点入口落回猫隐村 muye03（双向）", async () => {
    const res = await move("my_rukou");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.map).toMatchObject({ code: "maoyin_village", name: "猫隐村", type: "town" });
    expect(body.currentNodeCode).toBe("muye03");
    expect(body.nodes).toHaveLength(20);
  });

  it("城镇站在出口节点 muye03 上再点它也是 no-op", async () => {
    const res = await move("muye03");
    expect(res.statusCode).toBe(200);
    const cur = await current();
    expect(cur.json().map.code).toBe("maoyin_village");
    expect(cur.json().currentNodeCode).toBe("muye03");
  });

  it("战斗中移动返回 409，战斗结束后恢复", async () => {
    // 手插一条合法 battle 行：battles 有 FK，需先有角色与 map_node_monsters 实例行
    const [inst] = await getPool().query<ResultSetHeader>(
      `INSERT INTO map_node_monsters (map_code, node_code, monster_code, hp, max_hp, status)
       VALUES ('muye_caoyuan', 'my03', 'lvmaochong', 20, 40, 'alive')`,
    );
    const [battle] = await getPool().query<ResultSetHeader>(
      `INSERT INTO battles (character_id, monster_instance_id, monster_code, status, state)
       VALUES (?, ?, 'lvmaochong', 'active', '{}')`,
      [characterId, inst.insertId],
    );
    const res = await move("cunkou");
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe("战斗中无法移动");

    // 战斗结束后恢复移动
    await getPool().query("UPDATE battles SET status = 'finished' WHERE id = ?", [battle.insertId]);
    const ok = await move("cunkou");
    expect(ok.statusCode).toBe(200);

    // 清理手插行：实例行残留会破坏后续刷怪数量断言
    await getPool().query("DELETE FROM battles WHERE id = ?", [battle.insertId]);
    await getPool().query("DELETE FROM map_node_monsters WHERE id = ?", [inst.insertId]);
    const [left] = await getPool().query<RowDataPacket[]>(
      "SELECT COUNT(*) AS c FROM map_node_monsters WHERE map_code = 'muye_caoyuan'",
    );
    expect(left[0]?.c).toBe(0);
  });
});

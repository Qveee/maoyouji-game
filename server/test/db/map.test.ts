import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { buildApp } from "../../src/app.ts";
import { getPool } from "../../src/db.ts";
import { monsterIndex } from "../../src/data/loader.ts";
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
    // 城镇节点不刷怪：不带 monsters 字段（field 节点恒带，可为空数组）
    for (const n of body.nodes) expect(n.monsters).toBeUndefined();
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

  it("城镇任意位置点草原入口：跨图直接落在出口指向的实际格子 my03 并返回草原视图", async () => {
    const res = await move("muye03");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // 跨图成功：返回新地图视图（同 /map/current 结构），落点是门牌对面格子而非草原侧门牌
    expect(body.map).toMatchObject({ code: "muye_caoyuan", name: "牧野草原", type: "field" });
    expect(body.currentNodeCode).toBe("my03");
    expect(body.nodes).toHaveLength(38);
    expect(body.nodes.find((n: { code: string }) => n.code === "my03")).toBeTruthy();
  });

  it("站在跨图落点 my03 上再点它自身是 no-op", async () => {
    const res = await move("my03");
    expect(res.statusCode).toBe(200);
    expect(res.json().node).toMatchObject({ code: "my03" });
    const cur = await current();
    expect(cur.json().map.code).toBe("muye_caoyuan");
    expect(cur.json().currentNodeCode).toBe("my03");
  });

  it("野外非相邻移动返回 400", async () => {
    // my_rukou 只与 my03 相邻
    const res = await move("my00");
    expect(res.statusCode).toBe(400);
    expect(typeof res.json().message).toBe("string");
    expect(res.json().message.length).toBeGreaterThan(0);
  });

  it("野外相邻移动通过（去 my14 再折返 my03）", async () => {
    const res = await move("my14");
    expect(res.statusCode).toBe(200);
    expect(res.json().node).toMatchObject({ code: "my14", name: "牧野草原14" });
    const cur = await current();
    expect(cur.json().currentNodeCode).toBe("my14");
    const back = await move("my03");
    expect(back.statusCode).toBe(200);
  });

  it("返程：草原相邻格点村口入口落回猫隐村村口（双向）", async () => {
    const res = await move("my_rukou");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.map).toMatchObject({ code: "maoyin_village", name: "猫隐村", type: "town" });
    expect(body.currentNodeCode).toBe("cunkou");
    expect(body.nodes).toHaveLength(20);
  });

  it("城镇站在跨图落点村口上再点它自身也是 no-op", async () => {
    const res = await move("cunkou");
    expect(res.statusCode).toBe(200);
    const cur = await current();
    expect(cur.json().map.code).toBe("maoyin_village");
    expect(cur.json().currentNodeCode).toBe("cunkou");
  });

  it("城镇不能点草原侧出口节点（跨图只认本图出口）", async () => {
    // my_rukou 属于牧野草原：站猫隐村点它语义错误，必须先从本图出口 muye03 进草原
    const res = await move("my_rukou");
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe("目的地不可直达");
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
      "SELECT COUNT(*) AS c FROM map_node_monsters WHERE id = ?",
      [inst.insertId],
    );
    expect(left[0]?.c).toBe(0);
  });
});

describe("格子惰性刷怪与复活", () => {
  it("进入带 spawns 的格子出现 2~4 只活怪，重复进入不重复刷怪", async () => {
    // 回草原：muye03 跨图直落 my03（落点即此前已刷过的格子）→ my13（相邻，首次进入）
    await move("muye03");
    const arrive = await move("my13");
    expect(arrive.statusCode).toBe(200);

    const body = (await current()).json();
    const my13 = body.nodes.find((n: { code: string }) => n.code === "my13");
    expect(my13.monsters.length).toBeGreaterThanOrEqual(2);
    expect(my13.monsters.length).toBeLessThanOrEqual(4);
    for (const m of my13.monsters) {
      // my13 属新手区刷怪池（泡泡/绿毛虫/小鸡）；静态信息取自 monsters.json
      expect(["paopao", "lvmaochong", "xiaoji"]).toContain(m.code);
      const staticMonster = monsterIndex().get(m.code)!;
      expect(m.name).toBe(staticMonster.name);
      expect(m.level).toBe(staticMonster.level);
      expect(m.sprite).toBe(staticMonster.sprite);
      expect(m.maxHp).toBe(staticMonster.hpMax);
      expect(m.hp).toBeGreaterThanOrEqual(staticMonster.hpMin);
      expect(m.hp).toBeLessThanOrEqual(staticMonster.hpMax);
      expect(m.id).toBeGreaterThan(0);
    }

    // 幂等：绕开再回来，已有实例的格子不重复刷怪
    await move("my14");
    await move("my13");
    const again = (await current()).json();
    expect(again.nodes.find((n: { code: string }) => n.code === "my13").monsters).toHaveLength(
      my13.monsters.length,
    );
  });

  it("无 spawns 配置的格子（入口 my_rukou）绝不刷怪", async () => {
    const body = (await current()).json();
    expect(body.nodes.find((n: { code: string }) => n.code === "my_rukou").monsters).toEqual([]);
    const [cnt] = await getPool().query<RowDataPacket[]>(
      "SELECT COUNT(*) AS c FROM map_node_monsters WHERE node_code = 'my_rukou'",
    );
    expect(cnt[0]?.c).toBe(0);
  });

  it("全图到期尸体在查看地图时复活（HP 重 roll 回静态区间）", async () => {
    // 杀掉 my13 与 my03 两格（my03 非当前格，验证复活扫描是全图而非仅当前格）
    for (const node of ["my13", "my03"]) {
      await getPool().query(
        `UPDATE map_node_monsters SET status = 'dead', hp = 0,
         respawn_at = DATE_SUB(NOW(), INTERVAL 1 SECOND)
         WHERE map_code = 'muye_caoyuan' AND node_code = ?`,
        [node],
      );
    }
    const body = (await current()).json();
    for (const code of ["my13", "my03"]) {
      const node = body.nodes.find((n: { code: string }) => n.code === code);
      expect(node.monsters.length).toBeGreaterThan(0);
      for (const m of node.monsters) {
        const staticMonster = monsterIndex().get(m.code)!;
        expect(m.hp).toBeGreaterThanOrEqual(staticMonster.hpMin);
        expect(m.hp).toBeLessThanOrEqual(staticMonster.hpMax);
      }
    }
    // 库内：到期尸体全部复活、respawn_at 清空、HP 回到区间内
    const [rows] = await getPool().query<RowDataPacket[]>(
      "SELECT status, respawn_at, hp, monster_code FROM map_node_monsters WHERE node_code IN ('my13', 'my03')",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.status).toBe("alive");
      expect(r.respawn_at).toBeNull();
      const staticMonster = monsterIndex().get(r.monster_code as string)!;
      expect(Number(r.hp)).toBeGreaterThanOrEqual(staticMonster.hpMin);
    }
  });

  it("死亡未到期（respawn_at 在未来）保持尸体，不出现在怪物列表", async () => {
    await getPool().query(
      `UPDATE map_node_monsters SET status = 'dead', hp = 0,
       respawn_at = DATE_ADD(NOW(), INTERVAL 60 SECOND)
       WHERE map_code = 'muye_caoyuan' AND node_code = 'my13'`,
    );
    const body = (await current()).json();
    expect(body.nodes.find((n: { code: string }) => n.code === "my13").monsters).toEqual([]);
    // 库内仍是尸体
    const [rows] = await getPool().query<RowDataPacket[]>(
      "SELECT status FROM map_node_monsters WHERE node_code = 'my13'",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.status).toBe("dead");
  });
});

describe("兜底与防御", () => {
  it("相邻格点锁定节点返回 400（文案取 lockedReason，未配置时用默认文案）", async () => {
    // 从 my13 一路走到 my06（my_wanma 唯一相邻格），确保点击发生在相邻格上
    for (const code of ["my02", "my01", "my00", "my07", "my05", "my06"]) {
      const step = await move(code);
      expect(step.statusCode).toBe(200);
    }
    const res = await move("my_wanma");
    expect(res.statusCode).toBe(400);
    // my_wanma 未配置 lockedReason，走默认文案
    expect(res.json().message).toBe("该地点暂未开放");
  });

  it("静态数据漂移兜底：未知 monster_code 的实例不进视图、到期尸体被永久搁置", async () => {
    // 模拟 monsters.json 改名/删 code 后库里残留的实例行（map_node_monsters 无外键）
    await getPool().query(
      `INSERT INTO map_node_monsters (map_code, node_code, monster_code, hp, max_hp, status)
       VALUES ('muye_caoyuan', 'my04', 'ghost_monster', 10, 10, 'alive')`,
    );
    // 活着的幽灵行不进视图，也不应 500
    const res = await current();
    expect(res.statusCode).toBe(200);
    expect(res.json().nodes.find((n: { code: string }) => n.code === "my04").monsters).toEqual([]);

    // 尸体化并到期：复活扫描应将其永久搁置（dead + respawn_at=NULL），不再参与扫描
    await getPool().query(
      `UPDATE map_node_monsters SET status = 'dead', respawn_at = DATE_SUB(NOW(), INTERVAL 1 SECOND)
       WHERE monster_code = 'ghost_monster'`,
    );
    const res2 = await current();
    expect(res2.statusCode).toBe(200);
    const [row] = await getPool().query<RowDataPacket[]>(
      "SELECT status, respawn_at FROM map_node_monsters WHERE monster_code = 'ghost_monster'",
    );
    expect(row[0]?.status).toBe("dead");
    expect(row[0]?.respawn_at).toBeNull();
    // 清理幽灵行，避免影响其他用例
    await getPool().query("DELETE FROM map_node_monsters WHERE monster_code = 'ghost_monster'");
  });

  it("current_node_code 残留未知节点时惰性落库猫隐村出生点", async () => {
    await getPool().query("UPDATE characters SET current_node_code = 'ghost_node' WHERE id = ?", [
      characterId,
    ]);
    const res = await current();
    expect(res.statusCode).toBe(200);
    expect(res.json().map.code).toBe("maoyin_village");
    expect(res.json().currentNodeCode).toBe("guangchang");
    // 查库确认已惰性落库
    const [rows] = await getPool().query<RowDataPacket[]>(
      "SELECT current_node_code FROM characters WHERE id = ?",
      [characterId],
    );
    expect(rows[0]?.current_node_code).toBe("guangchang");
  });

  it("野外与出口节点不相邻的格子点出口返回 400（走格子到边缘再传送是设计意图）", async () => {
    // 回草原：muye03 跨图直落 my03 → my13（与 my_rukou 不相邻的远格）
    await move("muye03");
    await move("my13");
    const res = await move("my_rukou");
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe("目的地不可直达");
  });
});

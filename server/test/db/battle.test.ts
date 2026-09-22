import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { buildApp } from "../../src/app.ts";
import { getPool } from "../../src/db.ts";
import { itemIndex, monsterIndex } from "../../src/data/loader.ts";
import type { BattleState } from "../../src/game/engine.ts";
import { hpMaxOf, spMaxOf } from "../../src/game/rules.ts";
import { resetDb, registerAndLogin, cookieOf } from "./helpers.ts";

const app = buildApp();
let warriorCookie = "";
let mageCookie = "";
let warriorId = 0;
let mageId = 0;
/** 战士在 my03 的首战（贯穿发起/轮询/技能/平局用例） */
let warriorBattleId = 0;
let warriorMonsterId = 0;
/** 法师在 my13 的火球术战斗 */
let mageBattleId = 0;

beforeAll(async () => {
  await resetDb();
  // 账号 A：战士（my03 刷怪区）
  const accA = await registerAndLogin(app, "battlecat");
  const createdA = await app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie: accA },
    payload: { name: "打架猫", breedCode: "mao", profession: "warrior" },
  });
  warriorId = createdA.json().id;
  const selA = await app.inject({
    method: "POST",
    url: "/api/auth/select-character",
    headers: { cookie: accA },
    payload: { characterId: warriorId },
  });
  warriorCookie = cookieOf(selA);
  // 账号 B：法师（my13 刷怪区）
  const accB = await registerAndLogin(app, "battlemage");
  const createdB = await app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie: accB },
    payload: { name: "法术猫", breedCode: "mao", profession: "mage" },
  });
  mageId = createdB.json().id;
  const selB = await app.inject({
    method: "POST",
    url: "/api/auth/select-character",
    headers: { cookie: accB },
    payload: { characterId: mageId },
  });
  mageCookie = cookieOf(selB);
  // 战士进草原 my03：muye03 跨图直落 my03（门牌点对面的实际格子）
  await move(warriorCookie, "muye03");
  await move(warriorCookie, "my03");
  // 法师进 my13：muye03 跨图直落 my03 → my13（相邻）
  await move(mageCookie, "muye03");
  await move(mageCookie, "my03");
  await move(mageCookie, "my13");
});

afterAll(async () => {
  await app.close();
});

// ---------- 请求助手 ----------

function move(cookie: string, toCode: string) {
  return app.inject({ method: "POST", url: "/api/map/move", headers: { cookie }, payload: { toCode } });
}

function current(cookie: string) {
  return app.inject({ method: "GET", url: "/api/map/current", headers: { cookie } });
}

function battleStart(cookie: string, monsterInstanceId: number) {
  return app.inject({
    method: "POST",
    url: "/api/battle/start",
    headers: { cookie },
    payload: { monsterInstanceId },
  });
}

function battleState(cookie: string, sinceSeq = 0) {
  return app.inject({
    method: "GET",
    url: `/api/battle/state?sinceSeq=${sinceSeq}`,
    headers: { cookie },
  });
}

function battleSkill(cookie: string, code: string) {
  return app.inject({ method: "POST", url: "/api/battle/skill", headers: { cookie }, payload: { code } });
}

// ---------- 库内助手 ----------

/** battles 行（db 测试断言用列显式声明，避免 RowDataPacket 索引签名被展开丢弃） */
interface BattleRow extends RowDataPacket {
  id: number;
  character_id: number;
  monster_instance_id: number;
  monster_code: string;
  status: "active" | "finished";
  result: "victory" | "defeat" | "draw" | null;
  ended_at: Date | null;
}

/** 读角色最近一条 battle 行（state 兼容 mysql2 的字符串/已解析对象两种形态） */
async function battleRowOf(characterId: number) {
  const [rows] = await getPool().query<BattleRow[]>(
    `SELECT id, character_id, monster_instance_id, monster_code, status, result, ended_at, state
     FROM battles WHERE character_id = ? ORDER BY id DESC LIMIT 1`,
    [characterId],
  );
  const row = rows[0]!;
  const raw = row.state as unknown;
  const state = (typeof raw === "string" ? JSON.parse(raw) : raw) as BattleState;
  return { ...row, state };
}

/** 直改库内战斗快照（模拟时间流逝/数值夹具，不 sleep） */
async function patchState(battleId: number, patch: (s: BattleState) => void): Promise<void> {
  const [rows] = await getPool().query<RowDataPacket[]>("SELECT state FROM battles WHERE id = ?", [
    battleId,
  ]);
  const raw = rows[0]!.state as unknown;
  const s = (typeof raw === "string" ? JSON.parse(raw) : raw) as BattleState;
  patch(s);
  await getPool().query("UPDATE battles SET state = ? WHERE id = ?", [JSON.stringify(s), battleId]);
}

/**
 * 把战斗快照整体拨回 ms 毫秒前（模拟开打已有 ms 毫秒）。
 * 绝对时刻字段必须同步于此：startedAt / skillCdUntil / 双方 stunUntil 与 nextActAt。
 * skillCdUntil、stunUntil 平移后为负与 0 等价（视为未进 CD/未眩晕），安全。
 */
function rewindBy(s: BattleState, ms: number): void {
  s.startedAt -= ms;
  s.skillCdUntil -= ms;
  s.me.stunUntil -= ms;
  s.foe.stunUntil -= ms;
  s.me.nextActAt -= ms;
  s.foe.nextActAt -= ms;
}

async function monsterInstanceOf(id: number) {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT id, monster_code, hp, max_hp, status, respawn_at FROM map_node_monsters WHERE id = ?",
    [id],
  );
  return rows[0]!;
}

describe("发起战斗", () => {
  it("发起：响应态字段齐全，双方数值与实例/角色行一致", async () => {
    const view = await current(warriorCookie);
    expect(view.statusCode).toBe(200);
    const monsters = view.json().nodes.find((n: { code: string }) => n.code === "my03").monsters;
    expect(monsters.length).toBeGreaterThan(0);
    warriorMonsterId = monsters[0].id;
    const inst = await monsterInstanceOf(warriorMonsterId);

    const res = await battleStart(warriorCookie, warriorMonsterId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // 1 级战士（mao 五维全 5）：HP=50+5*8+10=100、SP=30+5*5+5=60
    expect(body.state).toMatchObject({
      hp: 100,
      maxHp: 100,
      sp: 60,
      maxSp: 60,
      foeHp: Number(inst.hp),
      foeMaxHp: Number(inst.max_hp),
      pendingSkill: null,
      skillCdUntil: 0,
      over: null,
    });
    expect(typeof body.state.now).toBe("number");
    expect(body.events).toEqual([]);

    // 库内 battles 行：active、怪物编码快照与实例一致、state 快照可往返
    const [rows] = await getPool().query<RowDataPacket[]>(
      "SELECT id, status, monster_code, state FROM battles WHERE character_id = ? AND status = 'active'",
      [warriorId],
    );
    expect(rows).toHaveLength(1);
    warriorBattleId = Number(rows[0]!.id);
    expect(rows[0]!.monster_code).toBe(inst.monster_code);
    const dbState = (await battleRowOf(warriorId)).state;
    expect(dbState.me.name).toBe("打架猫");
    expect(dbState.foe.name).toBe(monsterIndex().get(inst.monster_code as string)!.name);
    expect(dbState.foe.hp).toBe(Number(inst.hp)); // 实例行权威值，不从静态数据重派生
    expect(dbState.startedAt).toBeGreaterThan(0);
    expect(dbState.seed).toBeGreaterThanOrEqual(0);
  });

  it("防呆：重复发起 409、他格/不存在实例 400、战斗中移动 409 且带 battleId", async () => {
    const dup = await battleStart(warriorCookie, warriorMonsterId);
    expect(dup.statusCode).toBe(409);

    // 法师站 my13，挑战战士 my03 的怪：不属于当前格
    const other = await battleStart(mageCookie, warriorMonsterId);
    expect(other.statusCode).toBe(400);

    const ghost = await battleStart(warriorCookie, 999999);
    // 校验链按规格先查「已有 active 战斗」：战斗中连不存在的实例 id 也先撞 409 门
    expect(ghost.statusCode).toBe(409);
    expect(ghost.json().message).toBe("已有进行中的战斗");

    const res = await move(warriorCookie, "cunkou");
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe("战斗中无法移动");
    expect(Number(res.json().battleId)).toBe(warriorBattleId);
  });
});

describe("轮询与技能", () => {
  it("轮询推进：时间快进出事件、battles.state 回写、sinceSeq 只回增量", async () => {
    // 夹具：怪血量抬高防误杀；时间轴整体拨回 10 秒前模拟开打已久（不 sleep）
    await patchState(warriorBattleId, (s) => {
      s.foe.hp = 100000;
      s.foe.maxHp = 100000;
      rewindBy(s, 10_000);
    });
    const r1 = await battleState(warriorCookie, -1); // -1 = 全量（seq > -1 含首条）
    expect(r1.statusCode).toBe(200);
    const b1 = r1.json();
    expect(b1.events.length).toBeGreaterThan(0);
    expect(b1.state.foeHp).toBeLessThan(100000);
    const lastSeq = b1.events[b1.events.length - 1].seq;

    const r2 = await battleState(warriorCookie, lastSeq);
    expect(r2.statusCode).toBe(200);
    const b2 = r2.json();
    for (const e of b2.events) expect(e.seq).toBeGreaterThan(lastSeq);
    expect(b2.events.length).toBeLessThan(b1.events.length); // 增量严格小于全量

    // 库内回写：now 单调推进、事件流全量驻留（不截断）
    const row = await battleRowOf(warriorId);
    expect(row.state.now).toBe(b2.state.now);
    expect(row.state.events.length).toBe(b1.events.length + b2.events.length);
  });

  it("技能校验：职业不符 400、SP 不足 400", async () => {
    const wrong = await battleSkill(warriorCookie, "huoqiu_shu"); // 法师技能
    expect(wrong.statusCode).toBe(400);

    await patchState(warriorBattleId, (s) => {
      s.me.sp = 5;
    });
    const poor = await battleSkill(warriorCookie, "qiangli_daji"); // 25SP > 5SP
    expect(poor.statusCode).toBe(400);
    expect(poor.json().message).toBe("SP 不足");
  });

  it("战士强力打击激活：SP 扣减、待发标记、库内回写", async () => {
    await patchState(warriorBattleId, (s) => {
      s.me.sp = 60;
    });
    const res = await battleSkill(warriorCookie, "qiangli_daji");
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.state.pendingSkill).toMatchObject({ code: "qiangli_daji", kind: "next_hit_bonus", bonusDamage: 10 });
    expect(b.state.sp).toBe(35); // 60 − 25
    const row = await battleRowOf(warriorId);
    expect(row.state.me.sp).toBe(35);
    expect(row.state.pendingSkill?.code).toBe("qiangli_daji");
  });
});

describe("战斗结算", () => {
  it("3 分钟超时平局：怪回满复活、battles 落 finished", async () => {
    // 怪血量已被上一用例抬高（打不死），时间轴拨回 181 秒前 → 快进越过 3 分钟上限必平局
    await patchState(warriorBattleId, (s) => {
      rewindBy(s, 181_000);
    });
    const res = await battleState(warriorCookie, 0);
    expect(res.statusCode).toBe(200);
    expect(res.json().state.over).toMatchObject({ result: "draw" });

    const row = await battleRowOf(warriorId);
    expect(row.status).toBe("finished");
    expect(row.result).toBe("draw");
    expect(row.ended_at).toBeTruthy();

    // 实例回满复活（status=alive、hp=max_hp、respawn_at 清空）
    const inst = await monsterInstanceOf(warriorMonsterId);
    expect(inst.status).toBe("alive");
    expect(Number(inst.hp)).toBe(Number(inst.max_hp));
    expect(inst.respawn_at).toBeNull();
  });

  it("无进行中战斗：/state 与 /skill 返回 404", async () => {
    const r1 = await battleState(warriorCookie, 0);
    expect(r1.statusCode).toBe(404);
    expect(r1.json().message).toBe("当前没有进行中的战斗");
    const r2 = await battleSkill(warriorCookie, "qiangli_daji");
    expect(r2.statusCode).toBe(404);
  });

  it("静态数据漂移兜底：未知 monster_code 的实例发起返回 400", async () => {
    // 战士此时无 active 战斗（上一用例已平局收尾）：手插幽灵实例行到其当前格
    // （map_node_monsters 无外键，模拟 monsters.json 改名/删 code 后的残留）
    const [inst] = await getPool().query<ResultSetHeader>(
      `INSERT INTO map_node_monsters (map_code, node_code, monster_code, hp, max_hp, status)
       VALUES ('muye_caoyuan', 'my03', 'ghost_monster', 10, 10, 'alive')`,
    );
    try {
      const res = await battleStart(warriorCookie, Number(inst.insertId));
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe("怪物不存在");
    } finally {
      // 用后清理，避免幽灵行影响后续用例的刷怪/复活断言
      await getPool().query("DELETE FROM map_node_monsters WHERE id = ?", [inst.insertId]);
    }
  });

  it("胜利结算：经验入账升级、斩杀统计、实例尸体排程、hp 取战斗结束快照", async () => {
    // 平局用例已把 warriorMonsterId 复活，可直接再战；预置 60 经验保证击杀后必升 1 级
    await getPool().query("UPDATE characters SET exp = 60 WHERE id = ?", [warriorId]);
    const res = await battleStart(warriorCookie, warriorMonsterId);
    expect(res.statusCode).toBe(200);
    // 夹具作用在新开的这一战上（warriorBattleId 已随平局落 finished）
    const freshBattleId = Number((await battleRowOf(warriorId)).id);
    // 攻高首击必杀 + 当前 hp 压到 50（验证结算用战斗结束快照而非战前库值）+ 时间轴拨回 60 秒前
    await patchState(freshBattleId, (s) => {
      s.me.atk = 500;
      s.me.hp = 50;
      rewindBy(s, 60_000);
    });
    const poll = await battleState(warriorCookie, 0);
    expect(poll.statusCode).toBe(200);
    const body = poll.json();
    expect(body.state.over).toMatchObject({ result: "victory" });
    // 结算信息随 over 快照回传：本场经验与累计斩杀数/累计经验（首次击杀即 1 / exp）
    const expGained = body.state.over.expGained;
    expect(expGained).toBeGreaterThan(0);
    expect(body.state.over.killCount).toBe(1);
    expect(body.state.over.totalExpGained).toBe(expGained);

    const row = await battleRowOf(warriorId);
    expect(row.status).toBe("finished");
    expect(row.result).toBe("victory");
    const expOf = monsterIndex().get(row.monster_code as string)!.exp;

    // 角色：60 + exp ≥ 100 → 升 2 级；exp 为溢出余量
    const [chars] = await getPool().query<RowDataPacket[]>(
      "SELECT level, exp, vit, hp FROM characters WHERE id = ?",
      [warriorId],
    );
    const c = chars[0]!;
    expect(c.level).toBe(2);
    expect(Number(c.exp)).toBe(60 + expOf - 100);
    // hp = 战斗结束快照 + 升级上限增量（hpMaxOf(2,6)−hpMaxOf(1,5) = 118−100 = 18），绝非战前满值 100
    expect(Number(c.hp)).toBe(body.state.hp + 18);
    expect(Number(c.hp)).toBeGreaterThan(50);

    // 斩杀统计 UPSERT：kill_count=1、total_exp_gained=怪物经验
    const [stats] = await getPool().query<RowDataPacket[]>(
      "SELECT kill_count, total_exp_gained FROM character_monster_stats WHERE character_id = ? AND monster_code = ?",
      [warriorId, row.monster_code],
    );
    expect(stats).toHaveLength(1);
    expect(Number(stats[0]!.kill_count)).toBe(1);
    expect(Number(stats[0]!.total_exp_gained)).toBe(expOf);

    // 实例尸体化 + 复活排程（respawn_at 非空）
    const inst = await monsterInstanceOf(warriorMonsterId);
    expect(inst.status).toBe("dead");
    expect(inst.respawn_at).toBeTruthy();
  });

  it("尸体未刷新时发起返回 409", async () => {
    const res = await battleStart(warriorCookie, warriorMonsterId);
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe("怪物尚未刷新");
  });

  it("失败结算：角色回教堂满状态、怪回满复活", async () => {
    // 换 my03 另一只活怪开战
    const view = await current(warriorCookie);
    const monsters = view.json().nodes.find((n: { code: string }) => n.code === "my03").monsters;
    const other = monsters.find((m: { id: number }) => m.id !== warriorMonsterId);
    expect(other).toBeTruthy();
    const defeatMonsterId = other.id;

    const res = await battleStart(warriorCookie, defeatMonsterId);
    expect(res.statusCode).toBe(200);
    const row = await battleRowOf(warriorId);
    // 夹具：怪攻压高 + 时间轴拨回 60 秒前 → 怪首击（+2.2s 处）必杀我
    await patchState(Number(row.id), (s) => {
      s.foe.atk = 5000;
      rewindBy(s, 60_000);
    });
    const poll = await battleState(warriorCookie, 0);
    expect(poll.statusCode).toBe(200);
    expect(poll.json().state.over).toMatchObject({ result: "defeat" });

    const settled = await battleRowOf(warriorId);
    expect(settled.status).toBe("finished");
    expect(settled.result).toBe("defeat");

    // 角色落猫隐村教堂、HP/SP 按库中属性回满
    const [chars] = await getPool().query<RowDataPacket[]>(
      "SELECT current_node_code, level, vit, intel, hp, sp FROM characters WHERE id = ?",
      [warriorId],
    );
    const c = chars[0]!;
    expect(c.current_node_code).toBe("jiaotang");
    expect(Number(c.hp)).toBe(hpMaxOf(Number(c.level), Number(c.vit)));
    expect(Number(c.sp)).toBe(spMaxOf(Number(c.level), Number(c.intel)));

    // 实例回满复活
    const inst = await monsterInstanceOf(defeatMonsterId);
    expect(inst.status).toBe("alive");
    expect(Number(inst.hp)).toBe(Number(inst.max_hp));
    expect(inst.respawn_at).toBeNull();
  });

  it("法师火球术：SP 扣减、待发标记、咏唱顺延出手", async () => {
    const view = await current(mageCookie);
    const monsters = view.json().nodes.find((n: { code: string }) => n.code === "my13").monsters;
    expect(monsters.length).toBeGreaterThan(0);
    const res = await battleStart(mageCookie, monsters[0].id);
    expect(res.statusCode).toBe(200);
    mageBattleId = Number((await battleRowOf(mageId)).id);
    const before = (await battleRowOf(mageId)).state.me.nextActAt;

    const skill = await battleSkill(mageCookie, "huoqiu_shu");
    expect(skill.statusCode).toBe(200);
    const b = skill.json();
    expect(b.state.pendingSkill).toMatchObject({ code: "huoqiu_shu", kind: "direct_damage" });
    expect(b.state.sp).toBe(40); // 60 − 20

    const after = (await battleRowOf(mageId)).state;
    expect(after.me.nextActAt).toBeGreaterThanOrEqual(after.now + 4900); // 咏唱 5s 顺延
    expect(after.me.nextActAt).toBeGreaterThan(before);
  });

  it("结算幂等：结束后再轮询 404，斩杀统计不重复累计", async () => {
    // 把法师战局推到胜利（火球已待发，首击必杀；时间轴拨回 60 秒前让首击立即发生）
    await patchState(mageBattleId, (s) => {
      s.me.atk = 500;
      rewindBy(s, 60_000);
    });
    const poll = await battleState(mageCookie, 0);
    expect(poll.json().state.over).toMatchObject({ result: "victory" });

    const code = (await battleRowOf(mageId)).monster_code as string;
    const killCount = async (): Promise<number> => {
      const [rows] = await getPool().query<RowDataPacket[]>(
        "SELECT kill_count FROM character_monster_stats WHERE character_id = ? AND monster_code = ?",
        [mageId, code],
      );
      return Number(rows[0]!.kill_count);
    };
    expect(await killCount()).toBe(1);

    // 再轮询：无 active → 404，且统计不重复加
    const again = await battleState(mageCookie, 0);
    expect(again.statusCode).toBe(404);
    expect(await killCount()).toBe(1);
  });

  it("技能路由时序判别：advance 先于 activate（普攻先发生，技能不被吞）", async () => {
    const view = await current(mageCookie);
    const monsters = view.json().nodes.find((n: { code: string }) => n.code === "my13").monsters;
    expect(monsters.length).toBeGreaterThan(0);
    const res = await battleStart(mageCookie, monsters[0].id);
    expect(res.statusCode).toBe(200);
    const spAtStart = res.json().state.sp as number;
    const battleId = Number((await battleRowOf(mageId)).id);
    // 时间轴拨回 60 秒 + 怪血量抬高：/skill 内的 advance 会先处理 ~27 次普攻，之后才轮到激活
    await patchState(battleId, (s) => {
      s.foe.hp = 100000;
      s.foe.maxHp = 100000;
      rewindBy(s, 60_000);
    });
    const skill = await battleSkill(mageCookie, "huoqiu_shu");
    expect(skill.statusCode).toBe(200);
    const b = skill.json();
    // advance 先跑的证据：法师的首次行动是普通攻击事件（若 activate 先跑，首击会被技能吞掉变成 skill 事件）
    const firstMeEvent = b.events.find((e: { side: string }) => e.side === "me");
    expect(firstMeEvent).toBeTruthy();
    expect(firstMeEvent.kind).not.toBe("skill");
    expect(b.events.some((e: { side: string; kind: string }) => e.side === "me" && (e.kind === "hit" || e.kind === "crit"))).toBe(true);
    // 激活同时成立：待发保留（未被 advance 消费）、SP 扣减 20（初始 SP 受前面用例结算回写影响，取相对值）
    expect(b.state.pendingSkill).toMatchObject({ code: "huoqiu_shu" });
    expect(b.state.sp).toBe(spAtStart - 20);

    // 收尾：怪打不死必平局，把该战斗落 finished 释放法师的 active 名额
    await patchState(battleId, (s) => {
      rewindBy(s, 181_000);
    });
    const draw = await battleState(mageCookie, 0);
    expect(draw.json().state.over).toMatchObject({ result: "draw" });
  });

  it("技能路由终局分支：这一击打出胜负直接结算不再激活（SP 未扣）", async () => {
    const view = await current(mageCookie);
    const monsters = view.json().nodes.find((n: { code: string }) => n.code === "my13").monsters;
    expect(monsters.length).toBeGreaterThan(0);
    const res = await battleStart(mageCookie, monsters[0].id);
    expect(res.statusCode).toBe(200);
    const spAtStart = res.json().state.sp as number;
    const battleId = Number((await battleRowOf(mageId)).id);
    const code = (await battleRowOf(mageId)).monster_code as string;
    const killCountOf = async (): Promise<number> => {
      const [rows] = await getPool().query<RowDataPacket[]>(
        "SELECT kill_count FROM character_monster_stats WHERE character_id = ? AND monster_code = ?",
        [mageId, code],
      );
      return rows.length === 0 ? 0 : Number(rows[0]!.kill_count);
    };
    const before = await killCountOf();

    // 攻高首击必杀 + 时间轴拨回 60 秒：/skill 的 advance 直接打出胜负
    await patchState(battleId, (s) => {
      s.me.atk = 500;
      rewindBy(s, 60_000);
    });
    const skill = await battleSkill(mageCookie, "huoqiu_shu");
    expect(skill.statusCode).toBe(200);
    const b = skill.json();
    // 走结算分支而非激活：over 胜利、SP 未扣（激活会扣 20）、无待发
    expect(b.state.over).toMatchObject({ result: "victory" });
    expect(b.state.sp).toBe(spAtStart);
    expect(b.state.pendingSkill).toBeNull();
    // 副作用齐：battles finished、斩杀统计 +1
    const row = await battleRowOf(mageId);
    expect(row.status).toBe("finished");
    expect(row.result).toBe("victory");
    expect((await killCountOf())).toBe(before + 1);
  });
});

// ---------- 掉落与耐久结算（切片 5 Task 6）----------

describe("掉落与耐久结算", () => {
  /** 独立新角色：背包/铜币从零起步，掉落对账不受文件内其他用例结算残留的干扰 */
  let lootCookie = "";
  let lootCharId = 0;
  /** victory 用例击杀的实例 id（defeat 用例换一只活怪） */
  let slainMonsterId = 0;

  beforeAll(async () => {
    const acc = await registerAndLogin(app, "lootcat");
    const created = await app.inject({
      method: "POST",
      url: "/api/characters",
      headers: { cookie: acc },
      payload: { name: "捡漏猫", breedCode: "mao", profession: "warrior" },
    });
    lootCharId = created.json().id;
    const sel = await app.inject({
      method: "POST",
      url: "/api/auth/select-character",
      headers: { cookie: acc },
      payload: { characterId: lootCharId },
    });
    lootCookie = cookieOf(sel);
    await move(lootCookie, "muye03");
    await move(lootCookie, "my03");
  });

  it("victory：铜币入账、掉落入包、over.drops 对账", async () => {
    // 走到有怪格开战（刷怪随机，怪种不固定 → 断言全部走关系口径，与掉落随机性解耦）
    const view = await current(lootCookie);
    expect(view.statusCode).toBe(200);
    const monsters = view.json().nodes.find((n: { code: string }) => n.code === "my03").monsters;
    expect(monsters.length).toBeGreaterThan(0);
    slainMonsterId = monsters[0].id;
    const monsterCode = (await monsterInstanceOf(slainMonsterId)).monster_code as string;
    const dropTable = monsterIndex().get(monsterCode)!.drops!;

    const [copperBefore] = await getPool().query<RowDataPacket[]>(
      "SELECT copper FROM characters WHERE id = ?",
      [lootCharId],
    );
    const res = await battleStart(lootCookie, slainMonsterId);
    expect(res.statusCode).toBe(200);
    const battleId = Number((await battleRowOf(lootCharId)).id);
    // 种子拨成已知值（掉落续用战斗种子，快照可复现）+ 攻高首击必杀 + 时间轴拨回 60 秒前
    await patchState(battleId, (s) => {
      s.seed = 12345;
      s.me.atk = 500;
      rewindBy(s, 60_000);
    });
    const poll = await battleState(lootCookie, 0);
    expect(poll.statusCode).toBe(200);
    const over = poll.json().state.over;
    expect(over).toMatchObject({ result: "victory" });

    // ④ battles 落 victory，且 state.over.drops 持久化非空、与响应态一致
    expect(over.drops).toBeTruthy();
    const row = await battleRowOf(lootCharId);
    expect(row.status).toBe("finished");
    expect(row.result).toBe("victory");
    expect(row.state.over?.drops).toEqual(over.drops);

    // ② 角色 copper 增量 === over.drops.copper（初始铜币即战前库值）
    const [copperAfter] = await getPool().query<RowDataPacket[]>(
      "SELECT copper FROM characters WHERE id = ?",
      [lootCharId],
    );
    expect(Number(copperAfter[0]!.copper) - Number(copperBefore[0]!.copper)).toBe(over.drops.copper);
    // 铜币落在怪物掉落表区间内（掷点契约的最弱不变量）
    expect(over.drops.copper).toBeGreaterThanOrEqual(dropTable.copper[0]);
    expect(over.drops.copper).toBeLessThanOrEqual(dropTable.copper[1]);

    // ③ 包内新增行的 item_code 全部 ∈ 该怪掉落表，且无丢弃
    const [bagRows] = await getPool().query<RowDataPacket[]>(
      "SELECT item_code, quantity FROM character_inventory WHERE character_id = ? AND slot_index IS NOT NULL",
      [lootCharId],
    );
    expect(over.drops.lost).toEqual([]);
    const lootable = new Set(dropTable.items.map((e) => e.item));
    for (const r of bagRows) {
      expect(lootable.has(r.item_code as string)).toBe(true);
    }

    // ① over.drops.items 与包内 (item_code, 总 quantity) 对账（同码多段掉落合并后仍相等）
    const bagTotals = new Map<string, number>();
    for (const r of bagRows) {
      bagTotals.set(r.item_code as string, (bagTotals.get(r.item_code as string) ?? 0) + Number(r.quantity));
    }
    const dropTotals = new Map<string, number>();
    for (const it of over.drops.items) {
      dropTotals.set(it.code, (dropTotals.get(it.code) ?? 0) + it.qty);
      expect(typeof it.name).toBe("string"); // 展示快照：服务端已填名称，前端零静态数据依赖
    }
    expect(dropTotals).toEqual(bagTotals);
  });

  it("defeat：全身装备耐久 -ceil(5%×durabilityMax)，角色回教堂满状态", async () => {
    // SQL 直插两件装备入包并绑定穿戴位（军用盾牌/农夫之剑 durabilityMax 均 10；已穿戴 slot_index=NULL）
    const [shield] = await getPool().query<ResultSetHeader>(
      `INSERT INTO character_inventory (character_id, item_code, slot_index, quantity, durability)
       VALUES (?, 'junyong_dunpai', NULL, 1, 10)`,
      [lootCharId],
    );
    const [sword] = await getPool().query<ResultSetHeader>(
      `INSERT INTO character_inventory (character_id, item_code, slot_index, quantity, durability)
       VALUES (?, 'nongfuzhijian', NULL, 1, 10)`,
      [lootCharId],
    );
    await getPool().query(
      "INSERT INTO character_equipment (character_id, slot_code, inventory_id) VALUES (?, 'off_hand', ?)",
      [lootCharId, shield.insertId],
    );
    await getPool().query(
      "INSERT INTO character_equipment (character_id, slot_code, inventory_id) VALUES (?, 'main_hand', ?)",
      [lootCharId, sword.insertId],
    );

    // SQL 直插一只专属活怪开战：my03 刷怪数量随机（2~4），victory 用例可能杀掉最后一只，
    // 与刷怪随机性解耦（波利攻速 2400ms < 我方持剑 2600ms，必先手）。
    // HP 抬到 10 万防反杀：我方农夫之剑首击 ~13 点伤害绝无胜算。
    const [foe] = await getPool().query<ResultSetHeader>(
      `INSERT INTO map_node_monsters (map_code, node_code, monster_code, hp, max_hp, status)
       VALUES ('muye_caoyuan', 'my03', 'paopao', 100000, 100000, 'alive')`,
    );
    const res = await battleStart(lootCookie, Number(foe.insertId));
    expect(res.statusCode).toBe(200);
    const battleId = Number((await battleRowOf(lootCharId)).id);
    // 我方血量压到 1 + 怪攻拉满 → 怪首击必杀（时间轴拨回 60 秒前立即出手）
    await patchState(battleId, (s) => {
      s.me.hp = 1;
      s.foe.atk = 5000;
      rewindBy(s, 60_000);
    });
    const poll = await battleState(lootCookie, 0);
    expect(poll.statusCode).toBe(200);
    expect(poll.json().state.over).toMatchObject({ result: "defeat" });

    // 全身装备耐久：10 → 10 − ceil(10×0.05) = 9（损耗值 JS 侧按静态 durabilityMax 算）
    const [inv] = await getPool().query<RowDataPacket[]>(
      `SELECT i.item_code, i.durability FROM character_inventory i
       JOIN character_equipment e ON e.inventory_id = i.id
       WHERE e.character_id = ? ORDER BY i.id`,
      [lootCharId],
    );
    expect(inv).toHaveLength(2);
    for (const r of inv) {
      const item = itemIndex().get(r.item_code as string)!;
      if (item.kind !== "equipment") throw new Error(`非装备物品：${r.item_code as string}`); // 类型收窄
      expect(Number(r.durability)).toBe(item.durabilityMax - Math.ceil(item.durabilityMax * 0.05));
    }

    // 既有 defeat 口径不变：角色回教堂、按库中属性回满血蓝
    const [chars] = await getPool().query<RowDataPacket[]>(
      "SELECT current_node_code, level, vit, intel, hp, sp FROM characters WHERE id = ?",
      [lootCharId],
    );
    const c = chars[0]!;
    expect(c.current_node_code).toBe("jiaotang");
    expect(Number(c.hp)).toBe(hpMaxOf(Number(c.level), Number(c.vit)));
    expect(Number(c.sp)).toBe(spMaxOf(Number(c.level), Number(c.intel)));
    const row = await battleRowOf(lootCharId);
    expect(row.status).toBe("finished");
    expect(row.result).toBe("defeat");
  });
});

// ---------- 开战并入装备加成（终审补充用例）----------

describe("开战并入装备加成", () => {
  /** 独立新角色：裸装基准值可按规则式精确预期，不受文件内其他用例的装备/结算残留干扰 */
  let eqCookie = "";
  let eqCharId = 0;

  beforeAll(async () => {
    const acc = await registerAndLogin(app, "equipcat");
    const created = await app.inject({
      method: "POST",
      url: "/api/characters",
      headers: { cookie: acc },
      payload: { name: "并装猫", breedCode: "mao", profession: "warrior" },
    });
    eqCharId = created.json().id;
    const sel = await app.inject({
      method: "POST",
      url: "/api/auth/select-character",
      headers: { cookie: acc },
      payload: { characterId: eqCharId },
    });
    eqCookie = cookieOf(sel);
    await move(eqCookie, "muye03");
    await move(eqCookie, "my03");
  });

  it("穿农夫之剑开战：武器区间/攻速并入 state.me（裸装为徒手 1~3 / 2000ms）", async () => {
    // SQL 直插背包行（满耐久 10）并绑定 main_hand（与 defeat 用例同写法；levelReq 1 战士可用）
    const [inv] = await getPool().query<ResultSetHeader>(
      `INSERT INTO character_inventory (character_id, item_code, slot_index, quantity, durability)
       VALUES (?, 'nongfuzhijian', NULL, 1, 10)`,
      [eqCharId],
    );
    await getPool().query(
      "INSERT INTO character_equipment (character_id, slot_code, inventory_id) VALUES (?, 'main_hand', ?)",
      [eqCharId, inv.insertId],
    );

    const view = await current(eqCookie);
    expect(view.statusCode).toBe(200);
    const monsters = view.json().nodes.find((n: { code: string }) => n.code === "my03").monsters;
    expect(monsters.length).toBeGreaterThan(0);

    const res = await battleStart(eqCookie, monsters[0].id);
    expect(res.statusCode).toBe(200);
    // state.me 持久化快照对账（items.json 实际数值：农夫之剑 2-4 伤害 / 攻速 2600 / 无 bonuses）；
    // 裸装对照：dmgMin/dmgMax 缺省（攻击时兜底徒手 1~3）、战士攻速 2000
    const row = await battleRowOf(eqCharId);
    expect(row.state.me.dmgMin).toBe(2);
    expect(row.state.me.dmgMax).toBe(4);
    expect(row.state.me.intervalMs).toBe(2600);
    // 农夫之剑无 hp 词条 → maxHp 恒等于裸装基础值 hpMaxOf(1,5)=100，不得幻影抬升
    // （items.json 无任何 bonuses.hp 装备，且路由的 vit 加成不并入 maxHp，抬升断言无真实数据可构造）
    expect(row.state.me.maxHp).toBe(100);
    expect(row.state.me.hp).toBe(100);

    // 收尾：怪血抬高防误杀 + 时间轴拨回 181 秒前 → 超时平局释放 active 名额（文件内用例互不残留）
    await patchState(Number(row.id), (s) => {
      s.foe.hp = 100000;
      s.foe.maxHp = 100000;
      rewindBy(s, 181_000);
    });
    const draw = await battleState(eqCookie, 0);
    expect(draw.json().state.over).toMatchObject({ result: "draw" });
  });
});

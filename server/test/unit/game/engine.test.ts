import { describe, expect, it } from "vitest";
import {
  activateSkill,
  advance,
  createBattleState,
  type BattleState,
  type Combatant,
  type SkillPayload,
} from "../../../src/game/engine.ts";

/** activateSkill 的完整技能入参（payload + 消耗/冷却/咏唱） */
type SkillInput = SkillPayload & { sp: number; cdMs: number; castMs: number };

/** 战士 preset：强力打击（强化下一击 +10） */
const QIANGLI: SkillInput = {
  code: "qiangli_daji",
  name: "强力打击",
  kind: "next_hit_bonus",
  bonusDamage: 10,
  sp: 25,
  cdMs: 5000,
  castMs: 0,
};

/** 法师 preset：火球术（直接伤害 17~23，咏唱 5 秒） */
const HUOQIU: SkillInput = {
  code: "huoqiu_shu",
  name: "火球术",
  kind: "direct_damage",
  dmgMin: 17,
  dmgMax: 23,
  sp: 20,
  cdMs: 0,
  castMs: 5000,
};

/** 合成控制技能（MVP 两技能无控制，控制逻辑用合成夹具覆盖） */
const TENGCI: SkillInput = {
  code: "teng_ci",
  name: "藤刺",
  kind: "next_hit_bonus",
  bonusDamage: 0,
  stunMs: 3000,
  sp: 0,
  cdMs: 0,
  castMs: 0,
};

/** 玩家夹具：必中（dodge=0）不暴击（crit=0），攻 5 防 2，出手间隔 1s，血 90/100 */
function meFixture(overrides: Partial<Omit<Combatant, "stunUntil" | "nextActAt">> = {}) {
  return {
    name: "你",
    sprite: "/pets/mao.gif",
    level: 1,
    hp: 90,
    maxHp: 100,
    sp: 50,
    maxSp: 50,
    atk: 5,
    def: 2,
    dodge: 0,
    crit: 0,
    critMult: 1.5,
    intervalMs: 1000,
    ...overrides,
  };
}

/** 怪物夹具（绿毛虫）：必中不暴击，攻 2 防 0，出手间隔 1.5s，满血 */
function foeFixture(overrides: Partial<Omit<Combatant, "stunUntil" | "nextActAt">> = {}) {
  return {
    name: "绿毛虫",
    sprite: "/monsters/LuMaoChong.gif",
    level: 1,
    hp: 100,
    maxHp: 100,
    atk: 2,
    def: 0,
    dodge: 0,
    crit: 0,
    critMult: 1.5,
    intervalMs: 1500,
    ...overrides,
  };
}

/** 开一场 seed=7、nowMs=0 的标准战斗（绿毛虫经验 40，对应胜利文案「获得 40 点经验」） */
function battle(
  seed = 7,
  meOverrides: Partial<Omit<Combatant, "stunUntil" | "nextActAt">> = {},
  foeOverrides: Partial<Omit<Combatant, "stunUntil" | "nextActAt">> = {},
  foeExp = 40,
): BattleState {
  return createBattleState({ me: meFixture(meOverrides), foe: foeFixture(foeOverrides), foeExp }, seed, 0);
}

/** 激活技能并断言成功，返回新状态（失败直接炸测试） */
function activateOk(state: BattleState, skill: SkillInput, nowMs: number): BattleState {
  const r = activateSkill(state, skill, nowMs);
  if (!r.ok) throw new Error(`技能应激活成功，实际被拒：${r.reason}`);
  return r.state;
}

/** [kind, side, amount, t] 元组快照，便于整体断言事件流 */
function eventRows(s: BattleState) {
  return s.events.map((e) => [e.kind, e.side, e.amount, e.t]);
}

describe("createBattleState 初始状态", () => {
  it("双方 stunUntil=0、nextActAt=nowMs+interval，时间线与计数器归零，foeExp 照抄", () => {
    const s = battle(7, {}, {}, 40);
    expect(s.v).toBe(1);
    expect(s.seed).toBe(7);
    expect(s.startedAt).toBe(0);
    expect(s.now).toBe(0);
    expect(s.me.stunUntil).toBe(0);
    expect(s.foe.stunUntil).toBe(0);
    expect(s.me.nextActAt).toBe(1000); // 0 + 1000
    expect(s.foe.nextActAt).toBe(1500); // 0 + 1500
    expect(s.pendingSkill).toBeNull();
    expect(s.skillCdUntil).toBe(0);
    expect(s.foeExp).toBe(40);
    expect(s.seq).toBe(0);
    expect(s.events).toEqual([]);
    expect(s.over).toBeNull();
  });

  it("拷贝输入对象：改动返回的状态不波及调用方入参", () => {
    const me = meFixture();
    const s = createBattleState({ me, foe: foeFixture(), foeExp: 40 }, 7, 0);
    s.me.hp = 1;
    s.me.name = "改过的名字";
    expect(me.hp).toBe(90);
    expect(me.name).toBe("你");
  });
});

describe("advance 时间快进", () => {
  it("命中：固定种子下普攻造成精确伤害，行动后不回血（原版口径：战斗内无自然恢复）", () => {
    // seed=7 我方 t=1000 出手的三掷：0.0117(命中) → 0.0620(未暴击) → int(1,3)=3
    // 伤害 = max(1, 3 + 5(攻) - 0(防)) = 8
    const s1 = advance(battle(7), 1200);
    expect(s1.foe.hp).toBe(100 - 8);
    expect(s1.me.hp).toBe(90); // 行动不回血
    expect(eventRows(s1)).toEqual([
      ["hit", "me", 8, 1000],
    ]);
    expect(s1.now).toBe(1200);
    expect(s1.me.nextActAt).toBe(2000);
    expect(s1.foe.nextActAt).toBe(1500); // 未行动，保持不变
    expect(s1.over).toBeNull();

    // 在 s1 基础上继续快进：种子已回写，时间线无缝续跑（敌方 t=1500 还手）
    // 敌方三掷：0.6990(命中) → 0.5214(未暴击) → int(1,3)=2 → 伤害 = 2 + 2 - 2 = 2
    const s2 = advance(s1, 1600);
    expect(s2.me.hp).toBe(90 - 2);
    expect(s2.foe.hp).toBe(92); // 敌方行动同样不回血
    expect(eventRows(s2)).toEqual([
      ["hit", "me", 8, 1000],
      ["hit", "foe", 2, 1500],
    ]);
    expect(s2.now).toBe(1600);
  });

  it("闪避：目标闪避后不掉血，产生 miss 事件且无暴击/伤害", () => {
    // 敌方 dodge=1 → 命中阈值 0，第一掷 0.0117 必未中
    const s = advance(battle(7, {}, { dodge: 1 }), 1200);
    expect(s.foe.hp).toBe(100); // 毫发无损
    // miss 也是一次完整出手：只发 miss 事件
    expect(eventRows(s)).toEqual([
      ["miss", "me", undefined, 1000],
    ]);
    const miss = s.events[0]!;
    expect(miss.kind).toBe("miss");
    expect(miss.side).toBe("me");
    expect("amount" in miss).toBe(false); // miss 无伤害数值
    expect(miss.text).toContain("闪避");
    // 闪避仍算一次行动：推进出手时刻
    expect(s.me.hp).toBe(90);
    expect(s.me.nextActAt).toBe(2000);
  });

  it("暴击：伤害 = floor(roll×1.5) + atk − def，事件 kind 为 crit", () => {
    // seed=42 我方三掷：0.6011(命中) → 0.4483(暴击, crit=1 必爆) → int(1,3)=3
    // 伤害 = max(1, floor(3×1.5) + 5 - 0) = 4 + 5 = 9
    const s = advance(battle(42, { crit: 1 }), 1200);
    expect(s.foe.hp).toBe(100 - 9);
    expect(eventRows(s)).toEqual([
      ["crit", "me", 9, 1000],
    ]);
    const ev = s.events[0]!;
    expect(ev.kind).toBe("crit");
    expect(ev.amount).toBe(9);
    expect(ev.text).toContain("致命一击");
  });

  it("控制昏迷：昏迷方跳过行动顺延到 stunUntil，昏迷结束立即出手", () => {
    const s0 = structuredClone(battle(7));
    s0.foe.stunUntil = 5200; // 模拟已被控制到 5.2s
    const s = advance(s0, 6500);
    // 敌方 t=1500 轮到出手时处于昏迷 → 发 stun 事件并顺延到 5200，苏醒当刻立即出手
    expect(s.events[1]).toMatchObject({ kind: "stun", side: "foe", t: 1500 });
    expect(s.events[1]!.text).toContain("击晕");
    const foeHits = s.events.filter((e) => e.side === "foe" && (e.kind === "hit" || e.kind === "crit"));
    expect(foeHits).toHaveLength(1); // 昏迷期 1500~5200 之间一次都没出手
    expect(foeHits[0]!.t).toBe(5200);
    // 我方不受影响：1000/2000/3000/4000/5000/6000 共 6 次出手
    const meHits = s.events.filter((e) => e.side === "me" && (e.kind === "hit" || e.kind === "crit"));
    expect(meHits).toHaveLength(6);
    expect(s.foe.nextActAt).toBe(5200 + 1500);
    expect(s.over).toBeNull();
  });

  it("控制昏迷：带 stunMs 的合成技能命中后击晕目标", () => {
    const s1 = activateOk(battle(7), TENGCI, 0);
    const s = advance(s1, 5200);
    // t=1000 技能命中 → 目标 stunUntil = 1000 + 3000 = 4000
    expect(s.foe.stunUntil).toBe(4000);
    // 敌方 t=1500 昏迷顺延，t=4000 与我方同刻但我方先手，敌方随后苏醒出手
    expect(s.events[1]).toMatchObject({ kind: "stun", side: "foe", t: 1500 });
    const foeHits = s.events.filter((e) => e.side === "foe" && (e.kind === "hit" || e.kind === "crit"));
    expect(foeHits).toHaveLength(1);
    expect(foeHits[0]!.t).toBe(4000);
  });

  it("控制昏迷：既有更长的眩晕不被短控制覆盖", () => {
    // 防未来多控制源叠加时互相缩短：目标已眩晕到 9000，再吃 3s 控制不得提前到 4000
    const s0 = structuredClone(battle(7));
    s0.foe.stunUntil = 9000;
    const s = advance(activateOk(s0, TENGCI, 0), 5200);
    expect(s.foe.stunUntil).toBe(9000);
    expect(s.events.filter((e) => e.kind === "stun" && e.side === "foe")).toHaveLength(1); // 1500 一次顺延
    expect(s.foe.nextActAt).toBe(9000); // 苏醒时刻仍是最长眩晕
  });

  it("战斗内不回血：双方受损后行动也绝不产生 regen 事件", () => {
    // 原版口径：战斗中无自然恢复（回血靠药品，战斗外才按 5 秒窗口惰性补算）
    const s = advance(battle(7), 1600);
    expect(s.me.hp).toBe(90 - 2); // 掉血不回补
    expect(s.foe.hp).toBe(100 - 8);
    expect(s.events.map((e) => e.kind)).toEqual(["hit", "hit"]);
  });

  it("击杀：victory 结算 expGained=foeExp 并发 end 事件，此后不再产生事件", () => {
    // 攻 50 对 20 血绿毛虫：t=1000 一击 3+50=53 必杀
    const s = advance(battle(7, { atk: 50 }, { hp: 20, maxHp: 20 }), 60000);
    expect(s.over).toEqual({ result: "victory", expGained: 40 });
    expect(s.foe.hp).toBe(0);
    expect(s.events.map((e) => e.kind)).toEqual(["hit", "end"]);
    const end = s.events[1]!;
    expect(end.t).toBe(1000);
    expect(end.text).toBe("绿毛虫被你杀死了…");
    expect(s.now).toBe(60000); // 胜负已分，剩余时间只推进 now
  });

  it("被击杀：defeat 结算无经验，end 事件文本为战败", () => {
    // 5 血脆皮打草原蝎（攻 50）：我方 t=1000 打 8 点，敌方 t=1500 还手 2+50-2=50 击穿 6 血
    const s = advance(
      battle(7, { hp: 5 }, { name: "草原蝎", sprite: "/monsters/XieZi.gif", atk: 50, hp: 200, maxHp: 200 }, 120),
      60000,
    );
    expect(s.over?.result).toBe("defeat");
    expect(s.over?.expGained).toBeUndefined(); // 只有 victory 才有 expGained
    expect(s.me.hp).toBe(0);
    expect(s.events.map((e) => e.kind)).toEqual(["hit", "hit", "end"]);
    expect(s.events[2]!.text).toBe("你被 草原蝎 击败了！");
  });

  it("3 分钟平局：targetMs 远超上限时判定 draw 且推进停在 180 秒", () => {
    // 双方 10 万血攻 1：3 分钟内必打不死
    const tank = { hp: 100000, maxHp: 100000, atk: 1, def: 0 };
    const s = advance(battle(7, tank, tank), 999999);
    expect(s.over).toEqual({ result: "draw" });
    expect(s.now).toBe(180000); // 推进停在上限，不跟随 targetMs
    const end = s.events[s.events.length - 1]!;
    expect(end.kind).toBe("end");
    expect(end.text).toBe("战斗超时，不分胜负。");
    expect(end.t).toBe(180000);
    expect(s.events.every((e) => e.t <= 180000)).toBe(true);
    expect(s.me.hp).toBeGreaterThan(0);
    expect(s.foe.hp).toBeGreaterThan(0);

    // 已分出胜负后再快进：不再追加事件、不再改判
    const again = advance(s, 999999);
    expect(again.over).toEqual({ result: "draw" });
    expect(again.events).toHaveLength(s.events.length);
  });

  it("技能强化：next_hit_bonus 只加成第一击，随后恢复普攻", () => {
    const s1 = activateOk(battle(7), QIANGLI, 0);
    const s = advance(s1, 2500);
    // t=1000 技能击：roll = int(1,3)=3，+10 加成 → 伤害 = 13 + 5 = 18
    expect(s.events[0]!.kind).toBe("skill");
    expect(s.events[0]!.amount).toBe(18);
    expect(s.events[0]!.text).toContain("强力打击");
    expect(s.pendingSkill).toBeNull(); // 结算后清空
    // t=1500 敌方还手 2 点；t=2000 我方恢复徒手普攻：int=2 → 伤害 = 2 + 5 = 7（无 +10）
    expect(eventRows(s)).toEqual([
      ["skill", "me", 18, 1000],
      ["hit", "foe", 2, 1500],
      ["hit", "me", 7, 2000],
    ]);
    expect(s.foe.hp).toBe(100 - 18 - 7); // 受 18+7，行动不回血
  });

  it("direct_damage 技能：按 dmgMin~dmgMax roll 走命中/暴击管线，咏唱期间不出手", () => {
    const s1 = activateOk(battle(7), HUOQIU, 0);
    expect(s1.me.nextActAt).toBe(5000); // 咏唱：出手从 1000 顺延到 0+5000
    const s = advance(s1, 6000);
    // 咏唱期间敌方 1500/3000/4500 三次出手（各掷 3 次后）我方 t=5000 出火球：
    // 第 10~12 掷：0.7298(命中) → 0.2578(未暴击) → int(17,23)=17+floor(0.1559×7)=18 → 伤害 = 18 + 5 = 23
    const fireball = s.events[3]!;
    expect(fireball).toMatchObject({ kind: "skill", side: "me", amount: 23, t: 5000 });
    expect(fireball.text).toBe("你对绿毛虫释放【火球术】，造成23点伤害！");
    expect(s.pendingSkill).toBeNull();
    // 我方出手前挨 3+2+2=7 点（1500/3000/4500 三次还手）；
    // t=6000 与敌方同刻，我方先手普攻（掷 d13~d15 → int=1 → 伤害 6），敌方随后还手 2 点
    expect(eventRows(s)).toEqual([
      ["hit", "foe", 3, 1500],
      ["hit", "foe", 2, 3000],
      ["hit", "foe", 2, 4500],
      ["skill", "me", 23, 5000],
      ["hit", "me", 6, 6000],
      ["hit", "foe", 2, 6000],
    ]);
    expect(s.me.hp).toBe(90 - 7 - 2);
    expect(s.foe.hp).toBe(100 - 23 - 6);
  });
});

describe("武器伤害区间（Combatant.dmgMin/dmgMax）", () => {
  it("普攻用武器伤害区间替代徒手", () => {
    // 必中不暴击：伤害 = roll + atk − def；徒手 roll∈[1,3]、武器 [7,9]
    const unarmed = createBattleState({ me: meFixture(), foe: foeFixture(), foeExp: 10 }, 42, 0);
    const armed = createBattleState(
      { me: meFixture({ dmgMin: 7, dmgMax: 9 }), foe: foeFixture(), foeExp: 10 }, 42, 0,
    );
    const a = advance(unarmed, 1000);
    const b = advance(armed, 1000);
    const da = a.events.find((e) => e.kind === "hit")!.amount!;
    const db = b.events.find((e) => e.kind === "hit")!.amount!;
    expect(da).toBeGreaterThanOrEqual(1 + 5 - 0);  // roll_min + atk − def
    expect(db).toBeGreaterThanOrEqual(7 + 5 - 0);  // 武器下限抬升
    expect(db).toBeLessThanOrEqual(9 + 5 - 0);
  });

  it("next_hit_bonus 技能击走武器伤害区间（armed 分支），加成叠在武器 roll 之上", () => {
    // 同种子对照：双方夹具唯一差异是 dmgMin/dmgMax。三掷顺序锁定（命中 → 暴击 → roll），
    // seed=7 首击 roll 落在区间最高档（int(1,3)=3，见「技能强化」用例）→ 持械同掷点 int(7,9)=9。
    // 徒手技能击 16~18 与持械 22~24 两区间不相交：断言值落在持械区间即证 roll 源已切换为武器。
    const unarmed = advance(activateOk(battle(7), QIANGLI, 0), 1200);
    const armed = advance(activateOk(battle(7, { dmgMin: 7, dmgMax: 9 }), QIANGLI, 0), 1200);
    const da = unarmed.events[0]!;
    const db = armed.events[0]!;
    expect(da.kind).toBe("skill");
    expect(db.kind).toBe("skill");
    expect(da.amount).toBe(3 + 10 + 5 - 0); // 徒手：int(1,3)=3，+10 加成 +攻5
    expect(db.amount).toBe(9 + 10 + 5 - 0); // 持械：int(7,9)=9，非徒手区间的 18
    expect(db.amount).toBeGreaterThanOrEqual(7 + 10 + 5 - 0); // 双保险：持械区间下界
    expect(db.amount).toBeLessThanOrEqual(9 + 10 + 5 - 0); // 双保险：持械区间上界
    expect(db.text).toContain("强力打击");
  });

  it("旧快照无 dmgMin/dmgMax 字段时间线不变（?? UNARMED 兜底）", () => {
    const s = createBattleState({ me: meFixture(), foe: foeFixture(), foeExp: 10 }, 42, 0);
    const hacked = JSON.parse(JSON.stringify(s)); // 模拟持久化往返后无新字段
    expect(advance(hacked, 60000).events.map((e) => e.text)).toEqual(advance(s, 60000).events.map((e) => e.text));
  });
});

describe("activateSkill 技能激活", () => {
  it("通过路径：扣 SP、写 CD、标记待发、咏唱顺延 nextActAt，且不改入参", () => {
    const s0 = battle(7);
    const r = activateSkill(s0, HUOQIU, 0);
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.me.sp).toBe(50 - 20); // 立即扣 SP
    expect(r.state.skillCdUntil).toBe(0 + 0); // 火球术无 CD
    expect(r.state.pendingSkill).toEqual({
      code: "huoqiu_shu",
      name: "火球术",
      kind: "direct_damage",
      dmgMin: 17,
      dmgMax: 23,
    });
    expect(r.state.me.nextActAt).toBe(5000); // max(1000, 0+5000)
    // 入参保持原样（纯函数）
    expect(s0.me.sp).toBe(50);
    expect(s0.me.nextActAt).toBe(1000);
    expect(s0.pendingSkill).toBeNull();
    expect(s0.skillCdUntil).toBe(0);
  });

  it("拒绝：SP 不足", () => {
    const s0 = battle(7, { sp: 10 });
    expect(activateSkill(s0, QIANGLI, 0)).toEqual({ ok: false, reason: "SP 不足" });
  });

  it("拒绝：冷却中（待发技能已被消耗但 CD 未到）", () => {
    const longCd: SkillInput = { ...QIANGLI, cdMs: 60000 };
    const s1 = activateOk(battle(7), longCd, 0);
    const s2 = advance(s1, 1000); // t=1000 消耗掉待发技能
    expect(s2.pendingSkill).toBeNull();
    expect(activateSkill(s2, QIANGLI, 1500)).toEqual({ ok: false, reason: "技能冷却中" });
  });

  it("拒绝：重复激活（已有待发技能）", () => {
    const s0 = battle(7);
    // 纯函数：需把第一次激活返回的新状态链给第二次调用
    const s1 = activateOk(s0, QIANGLI, 0);
    expect(activateSkill(s1, QIANGLI, 0)).toEqual({ ok: false, reason: "已有待发的技能" });
  });

  it("拒绝：战斗已结束", () => {
    const s0 = battle(7);
    s0.over = { result: "draw" };
    expect(activateSkill(s0, QIANGLI, 0)).toEqual({ ok: false, reason: "战斗已结束" });
  });
});

describe("确定性与纯函数性", () => {
  it("同种子确定性：同种子两次快进结果全等（含 seed 回写），异种子序列不同", () => {
    // 闪避/暴击居中夹具，让随机掷点充分参与事件形态
    const wild = { dodge: 0.3, crit: 0.5 };
    const a = advance(battle(7, wild, wild), 20000);
    const b = advance(battle(7, wild, wild), 20000);
    expect(b).toEqual(a); // 整个状态深度相等：事件流、seed 回写、时间线全部一致
    expect(a.seed).not.toBe(7); // 消耗过 RNG 后种子已前滚
    const c = advance(battle(42, wild, wild), 20000);
    expect(c).not.toEqual(a);
  });

  it("纯函数性：advance / activateSkill 调用前后入参深度不变", () => {
    const s0 = battle(7);
    const before = structuredClone(s0);
    advance(s0, 5000);
    expect(structuredClone(s0)).toEqual(before);
    const r = activateSkill(s0, QIANGLI, 0);
    expect(r.ok).toBe(true);
    expect(structuredClone(s0)).toEqual(before); // 拒绝/成功都不改入参
  });

  it("JSON 往返守卫：从 battles.state 快照（JSON 序列化）读回复跑，与内存对象续跑深度一致", () => {
    // 持久化核心契约：state 经 JSON 落库再读回后，RNG 时间线必须原样续跑
    const wild = { dodge: 0.3, crit: 0.5 };
    const live = advance(battle(7, wild, wild), 10000);
    const revived = JSON.parse(JSON.stringify(live)) as BattleState;
    expect(advance(revived, 20000)).toEqual(advance(structuredClone(live), 20000));
  });

  it("targetMs <= now 时快进为 no-op：now 单调不回退、不产生事件、整体幂等", () => {
    // 轮询重叠/旧请求晚到会真实走到：目标时刻早于当前时间线
    const s0 = advance(battle(7), 1200);
    const before = structuredClone(s0);
    const s = advance(s0, 500);
    expect(s.now).toBe(1200); // now 只前进不回退
    expect(s).toEqual(before);
  });
});

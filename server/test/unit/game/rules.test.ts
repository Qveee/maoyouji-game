import { describe, expect, it } from "vitest";
import {
  applyLevelUps,
  atkOf,
  BASE_CRIT,
  CRIT_MULT,
  defOf,
  dodgeOf,
  expNeedOf,
  hpMaxOf,
  lazyRegen,
  PLAYER_ATTACK_MS,
  spMaxOf,
  statGainOf,
  UNARMED_MAX,
  UNARMED_MIN,
} from "../../../src/game/rules.ts";

/** 构造一名 1 级战士（各调用点拿全新对象，避免用例间串扰） */
function warriorBase() {
  return {
    level: 1,
    exp: 0,
    vit: 5,
    str: 5,
    agi: 5,
    intel: 5,
    spr: 5,
    hp: 20,
    sp: 10,
    profession: "warrior" as const,
    growth: { vit: 0.6, str: 0.6, agi: 0.5, intel: 0.4, spr: 0.5 },
  };
}

describe("派生属性公式", () => {
  it("HP/SP 上限已知值", () => {
    expect(hpMaxOf(1, 5)).toBe(100); // 50 + 5*8 + 1*10
    expect(spMaxOf(1, 5)).toBe(60); // 30 + 5*5 + 1*5
  });

  it("攻击力按职业取主属性", () => {
    expect(atkOf("warrior", 7, 3)).toBe(14); // 战士 str*2
    expect(atkOf("mage", 7, 9)).toBe(18); // 法师 intel*2
  });

  it("防御取整与闪避封顶", () => {
    expect(defOf(4)).toBe(6); // floor(4*1.5)
    expect(dodgeOf(50)).toBeCloseTo(0.15); // 50*0.3% 未封顶
    expect(dodgeOf(200)).toBe(0.4); // 40% 封顶
  });

  it("锁定常量", () => {
    expect(BASE_CRIT).toBe(0.05);
    expect(CRIT_MULT).toBe(1.5);
    expect(PLAYER_ATTACK_MS).toEqual({ warrior: 2000, mage: 2200 });
    expect(UNARMED_MIN).toBe(1);
    expect(UNARMED_MAX).toBe(3);
  });
});

describe("经验与升级", () => {
  it("升级所需经验用 floor（L=2 时 round 会错得 283）", () => {
    expect(expNeedOf(1)).toBe(100);
    expect(expNeedOf(2)).toBe(282); // floor(100 * 2^1.5) = floor(282.84)
  });

  it("无状态差分取整的五维成长", () => {
    expect(statGainOf(0.6, 2)).toBe(1); // floor(1.2) - floor(0.6) = 1 - 0
    expect(statGainOf(0.6, 3)).toBe(0); // floor(1.8) - floor(1.2) = 1 - 1
  });

  it("连升 2 级：溢出进位、主属性 +1/级、五维按差分累积、hp/sp 加上限增量", () => {
    const r = applyLevelUps(warriorBase(), 400); // 100+282=382 够连升两级，剩 18
    expect(r).toMatchObject({
      level: 3,
      exp: 18,
      leveledTo: 3,
      // vit: 5+(1+0)；str: 5+(1+1)+(0+1)；agi: 5+(1+0)；intel: 5+(0+1)；spr: 5+(1+0)
      vit: 6,
      str: 8,
      agi: 6,
      intel: 6,
      spr: 6,
      // hp: 20 + (118-100) + (128-118)；sp: 10 + (65-60) + (75-65)
      hp: 48,
      sp: 25,
    });
  });

  it("法师主属性为 intel，每级额外 +1", () => {
    const input = {
      ...warriorBase(),
      profession: "mage" as const,
      hp: 100,
      sp: 30,
      growth: { vit: 0.4, str: 0.4, agi: 0.4, intel: 0.4, spr: 0.4 },
    };
    const r = applyLevelUps(input, 100); // 刚好升 1 级，exp 归零
    expect(r).toMatchObject({
      level: 2,
      exp: 0,
      leveledTo: 2,
      vit: 5,
      str: 5,
      agi: 5,
      intel: 6, // 差分成长 0 + 主属性 1
      spr: 5,
      hp: 110, // 100 + (110-100)，vit 无成长故上限增量只含等级贡献
      sp: 40, // 30 + (70-60)，上限随 intel+1 重算
    });
  });

  it("纯函数：不修改入参对象", () => {
    const input = warriorBase();
    const snapshot = structuredClone(input);
    applyLevelUps(input, 400);
    expect(input).toEqual(snapshot);
  });

  it("未升级时 leveledTo 为 null，属性原样", () => {
    const r = applyLevelUps(warriorBase(), 50);
    expect(r.leveledTo).toBeNull();
    expect(r).toMatchObject({
      level: 1,
      exp: 50,
      vit: 5,
      str: 5,
      agi: 5,
      intel: 5,
      spr: 5,
      hp: 20,
      sp: 10,
    });
  });
});

describe("战斗外惰性恢复", () => {
  const base = { hp: 50, sp: 30, maxHp: 200, maxSp: 100, spr: 10, intel: 10 };
  const now = 1_000_000;

  it("跨 17000ms = 3 跳：spr=10 回 18 HP，intel=10 回 9 SP", () => {
    expect(lazyRegen({ ...base, resourcesUpdatedAt: now - 17_000 }, now)).toEqual({ hp: 68, sp: 39 });
  });

  it("不足 5000ms 不回复", () => {
    expect(lazyRegen({ ...base, resourcesUpdatedAt: now - 4999 }, now)).toEqual({ hp: 50, sp: 30 });
  });

  it("恰好 5000ms 回一跳", () => {
    expect(lazyRegen({ ...base, resourcesUpdatedAt: now - 5000 }, now)).toEqual({ hp: 56, sp: 33 });
  });

  it("超过上限封顶", () => {
    expect(lazyRegen({ ...base, hp: 195, sp: 95, resourcesUpdatedAt: now - 17_000 }, now)).toEqual({
      hp: 200,
      sp: 100,
    });
  });

  it("resourcesUpdatedAt 在未来（负 ticks）原值返回", () => {
    expect(lazyRegen({ ...base, resourcesUpdatedAt: now + 10_000 }, now)).toEqual({ hp: 50, sp: 30 });
  });

  it("纯函数：不修改入参", () => {
    const p = { ...base, resourcesUpdatedAt: now - 17_000 };
    const snapshot = structuredClone(p);
    lazyRegen(p, now);
    expect(p).toEqual(snapshot);
  });
});

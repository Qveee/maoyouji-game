/**
 * 战斗数值纯函数层：派生属性 / 经验升级 / 惰性恢复。
 *
 * 数值来源：docs/游戏规则设计.md §3/§6/§7 与切片 4 实施计划的「数值决策」节
 * （无装备 MVP 基准）。全部为无 IO 纯函数，便于单测与战斗结算器复用。
 */

// ---------- 派生属性 ----------

/** HP 上限 = 50 + vit*8 + level*10（创建角色路由已按同式实现） */
export function hpMaxOf(level: number, vit: number): number {
  return 50 + vit * 8 + level * 10;
}

/** SP 上限 = 30 + intel*5 + level*5 */
export function spMaxOf(level: number, intel: number): number {
  return 30 + intel * 5 + level * 5;
}

/** 攻击力：战士 str*2 / 法师 intel*2 */
export function atkOf(profession: "warrior" | "mage", str: number, intel: number): number {
  return profession === "warrior" ? str * 2 : intel * 2;
}

/** 防御 = floor(agi*1.5) */
export function defOf(agi: number): number {
  return Math.floor(agi * 1.5);
}

/** 闪避率 = min(40%, agi*0.3%) */
export function dodgeOf(agi: number): number {
  return Math.min(0.4, agi * 0.003);
}

/** 基础暴击率 5% */
export const BASE_CRIT = 0.05;
/** 暴击伤害倍率 150% */
export const CRIT_MULT = 1.5;
/** 玩家出手间隔（ms） */
export const PLAYER_ATTACK_MS = { warrior: 2000, mage: 2200 } as const;
/** 徒手伤害下限（无武器系统前的 MVP 基准） */
export const UNARMED_MIN = 1;
/** 徒手伤害上限 */
export const UNARMED_MAX = 3;

// ---------- 经验与升级 ----------

/** 升到 level+1 所需经验 = floor(100 * L^1.5)。必须 floor 而非 round（L=2 时 round 会得 283） */
export function expNeedOf(level: number): number {
  return Math.floor(100 * level ** 1.5);
}

/** 无状态差分取整的五维成长：floor(g*L) - floor(g*(L-1))，长期收敛到 growth 系数本身 */
export function statGainOf(growth: number, newLevel: number): number {
  return Math.floor(growth * newLevel) - Math.floor(growth * (newLevel - 1));
}

/**
 * 结算一次获得经验并循环处理全部升级。
 * 纯函数：不修改入参 p，返回带 leveledTo（最终等级，未升级为 null）的新对象。
 * 升级中 vit/intel 也在涨，hp/sp 按上限增量累加即天然包含其贡献（增量恒正，无需 clamp）。
 */
export function applyLevelUps(
  p: {
    level: number;
    exp: number;
    vit: number;
    str: number;
    agi: number;
    intel: number;
    spr: number;
    hp: number;
    sp: number;
    profession: "warrior" | "mage";
    growth: { vit: number; str: number; agi: number; intel: number; spr: number };
  },
  gained: number,
): {
  level: number;
  exp: number;
  vit: number;
  str: number;
  agi: number;
  intel: number;
  spr: number;
  hp: number;
  sp: number;
  leveledTo: number | null;
} {
  // 拷贝一份做工作区，保证调用方对象不被改动
  const r = { ...p };
  r.exp += gained;
  let leveledTo: number | null = null;
  while (r.exp >= expNeedOf(r.level)) {
    const oldLevel = r.level;
    const oldVit = r.vit;
    const oldIntel = r.intel;
    r.exp -= expNeedOf(r.level);
    r.level += 1;
    // 五维无状态差分取整成长
    r.vit += statGainOf(p.growth.vit, r.level);
    r.str += statGainOf(p.growth.str, r.level);
    r.agi += statGainOf(p.growth.agi, r.level);
    r.intel += statGainOf(p.growth.intel, r.level);
    r.spr += statGainOf(p.growth.spr, r.level);
    // 职业主属性每级额外 +1（战士 str / 法师 intel）
    if (r.profession === "warrior") {
      r.str += 1;
    } else {
      r.intel += 1;
    }
    // 当前 hp/sp 加上限增量
    r.hp += hpMaxOf(r.level, r.vit) - hpMaxOf(oldLevel, oldVit);
    r.sp += spMaxOf(r.level, r.intel) - spMaxOf(oldLevel, oldIntel);
    leveledTo = r.level;
  }
  return {
    level: r.level,
    exp: r.exp,
    vit: r.vit,
    str: r.str,
    agi: r.agi,
    intel: r.intel,
    spr: r.spr,
    hp: r.hp,
    sp: r.sp,
    leveledTo,
  };
}

// ---------- 战斗外惰性恢复 ----------

/** 恢复一跳的间隔（ms） */
const REGEN_TICK_MS = 5000;

/**
 * 战斗外 HP/SP 惰性恢复：按 resourcesUpdatedAt 与 nowMs 的时间差补算，5s 一跳。
 * 服务器零定时器，由读路径随时调用。纯函数：不回写 resourcesUpdatedAt，
 * 由调用方结算后自行推进该时间戳。
 */
export function lazyRegen(
  p: {
    hp: number;
    sp: number;
    maxHp: number;
    maxSp: number;
    spr: number;
    intel: number;
    resourcesUpdatedAt: number;
  },
  nowMs: number,
): { hp: number; sp: number } {
  const ticks = Math.floor((nowMs - p.resourcesUpdatedAt) / REGEN_TICK_MS);
  // 不足一跳（含时间戳在未来导致负数）：原值返回
  if (ticks <= 0) {
    return { hp: p.hp, sp: p.sp };
  }
  return {
    hp: Math.min(p.maxHp, p.hp + Math.floor(ticks * (1 + p.spr * 0.5))),
    sp: Math.min(p.maxSp, p.sp + Math.floor(ticks * (1 + p.intel * 0.2))),
  };
}

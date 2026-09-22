/**
 * 战斗结算器纯函数引擎（切片 4 最高风险项）。
 *
 * 设计约束（docs/superpowers/plans/2026-09-21-battle-engine.md Task 4）：
 * - 全部逻辑为纯函数：无 IO、无定时器、无 Date.now()，时间一律由入参 nowMs / targetMs 注入，
 *   服务器零定时器，由前端 1s 轮询驱动 advance 快进；
 * - 固定种子 RNG（rng.ts mulberry32）：同种子同输入 → 事件序列完全一致；每次 advance 结束把
 *   RNG 内部状态回写 state.seed，多次快进拼成一条连续可复现的时间线；
 * - 状态整体可 JSON 序列化（battles.state 快照持久化），因此不含任何函数/循环引用；
 * - 事件 text 由服务端预生成中文（前端只管渲染飘字/聊天行）。
 */

import { createRng, type Rng } from "./rng.ts";
import { UNARMED_MAX, UNARMED_MIN } from "./rules.ts";

// ---------- 类型 ----------

/** 战斗参与方（玩家或怪物）的战斗内数值快照。intervalMs 必须 > 0（否则时间线无法推进） */
export interface Combatant {
  name: string;
  sprite: string;
  level: number;
  hp: number;
  maxHp: number;
  sp?: number;
  maxSp?: number;
  atk: number;
  def: number;
  dodge: number;
  crit: number;
  critMult: number;
  intervalMs: number;
  /** 昏迷截止时刻（ms）；> 当前行动时刻则跳过出手 */
  stunUntil: number;
  /** 下一次出手的时刻（ms） */
  nextActAt: number;
}

/** 待发技能载荷：activateSkill 标记、玩家的下一次行动改为按此结算 */
export type SkillPayload = {
  code: string;
  name: string;
  kind: "next_hit_bonus" | "direct_damage";
  bonusDamage?: number;
  dmgMin?: number;
  dmgMax?: number;
  stunMs?: number;
};

export interface BattleEvent {
  seq: number;
  t: number;
  side: "me" | "foe";
  /** regen 已停产（战斗内不回血，原版口径），仅旧快照回放时可能出现 */
  kind: "hit" | "crit" | "miss" | "skill" | "stun" | "regen" | "end";
  amount?: number;
  text: string;
}

export interface BattleState {
  v: 1;
  seed: number;
  startedAt: number;
  now: number;
  me: Combatant;
  foe: Combatant;
  pendingSkill: SkillPayload | null;
  skillCdUntil: number;
  foeExp: number;
  seq: number;
  events: BattleEvent[];
  over: null | { result: "victory" | "defeat" | "draw"; expGained?: number };
}

/** 战斗时长上限：MVP 无逃跑，快进越过 3 分钟仍无胜负即平局脱战（设计决策 #3） */
const BATTLE_DURATION_MS = 180000;

// ---------- 创建战斗 ----------

/**
 * 创建初始战斗状态。双方 stunUntil=0、nextActAt = nowMs + intervalMs（开打后隔一个攻速间隔才首次出手）。
 * 深拷贝入参战斗数值：后续 advance 的演化不会波及调用方持有的对象。
 */
export function createBattleState(
  input: {
    me: Omit<Combatant, "stunUntil" | "nextActAt">;
    foe: Omit<Combatant, "stunUntil" | "nextActAt">;
    foeExp: number;
  },
  seed: number,
  nowMs: number,
): BattleState {
  return {
    v: 1,
    seed,
    startedAt: nowMs,
    now: nowMs,
    me: { ...structuredClone(input.me), stunUntil: 0, nextActAt: nowMs + input.me.intervalMs },
    foe: { ...structuredClone(input.foe), stunUntil: 0, nextActAt: nowMs + input.foe.intervalMs },
    pendingSkill: null,
    skillCdUntil: 0,
    foeExp: input.foeExp,
    seq: 0,
    events: [],
    over: null,
  };
}

// ---------- 内部工具 ----------

/** 追加事件并推进 seq（自增序号，供前端 sinceSeq=N 增量拉取事件） */
function pushEvent(s: BattleState, e: Omit<BattleEvent, "seq">): void {
  s.events.push({ seq: s.seq++, ...e });
}

/**
 * 结算一次攻击（普攻或技能强化）。RNG 消耗顺序锁定（单测夹具依赖）：
 * 命中判定 next() → （命中才）暴击判定 next() → （命中才）伤害 roll int()；闪避只消耗 1 掷。
 * 伤害管线：max(1, floor(roll × 暴击倍率) + atk − def)，实扣以目标剩余血量为上限。
 */
function resolveAttack(
  s: BattleState,
  rng: Rng,
  t: number,
  side: "me" | "foe",
  skill: SkillPayload | null,
): void {
  const attacker = s[side];
  const targetSide: "me" | "foe" = side === "me" ? "foe" : "me";
  const target = s[targetSide];

  // a. 命中判定：掷点落在 (1 - 目标闪避率) 内才算命中
  if (rng.next() >= 1 - target.dodge) {
    pushEvent(s, {
      t,
      side,
      kind: "miss",
      text: side === "me" ? `你的攻击被 ${target.name} 闪避了！` : `${attacker.name} 发动攻击，你闪避了！`,
    });
    return;
  }
  // b. 暴击判定（技能同样走这道判定）
  const isCrit = rng.next() < attacker.crit;
  // c. 伤害 roll：普攻徒手 1~3；next_hit_bonus = 徒手 roll + 固定加成；direct_damage = 技能自带区间
  let roll: number;
  if (skill === null) {
    roll = rng.int(UNARMED_MIN, UNARMED_MAX);
  } else if (skill.kind === "next_hit_bonus") {
    roll = rng.int(UNARMED_MIN, UNARMED_MAX) + (skill.bonusDamage ?? 0);
  } else {
    const lo = skill.dmgMin ?? UNARMED_MIN;
    roll = rng.int(lo, skill.dmgMax ?? lo);
  }
  // d. 暴击乘区先取整再加减攻防，保底 1 点；实扣 = min(目标当前血量, 伤害)
  const dmg = Math.max(1, Math.floor(roll * (isCrit ? attacker.critMult : 1)) + attacker.atk - target.def);
  const dealt = Math.min(target.hp, dmg);
  target.hp -= dealt;

  // e. 事件 kind 优先级：暴击 > 技能 > 普攻（前端暴击样式优先展示；text 始终带足信息）
  const kind = isCrit ? "crit" : skill !== null ? "skill" : "hit";
  let text: string;
  if (side === "me") {
    if (skill !== null) {
      text = isCrit
        ? `你对 ${target.name} 发动了${skill.name}，触发暴击造成 ${dealt} 点伤害！`
        : `你对 ${target.name} 发动了${skill.name}，造成 ${dealt} 点伤害！`;
    } else {
      text = isCrit
        ? `你对 ${target.name} 发动了暴击，造成 ${dealt} 点伤害！`
        : `你攻击 ${target.name}，造成 ${dealt} 点伤害！`;
    }
  } else {
    text = isCrit
      ? `${attacker.name} 的暴击对你造成 ${dealt} 点伤害！`
      : `${attacker.name} 攻击你，造成 ${dealt} 点伤害！`;
  }
  pushEvent(s, { t, side, kind, amount: dealt, text });

  // 控制附效：带 stunMs 的技能命中（非闪避）后击晕目标；实际跳过行动在目标下次轮到时判定。
  // 取 max 而非直接赋值：未来多控制源叠加时，短控制不得缩短目标既有的更长眩晕
  if (skill?.stunMs !== undefined) {
    target.stunUntil = Math.max(target.stunUntil, t + skill.stunMs);
  }
}

// ---------- 时间快进 ----------

/**
 * 把战斗时间线快进到 targetMs（唯一真源，路由层只调这里）。
 * 逐个行动推进：每次取 (nextActAt, me<foe) 最小者行动；快进越过 3 分钟仍无胜负判平局。
 * 纯函数：深拷贝入参为工作区，绝不改写调用方持有的旧快照。
 */
export function advance(state: BattleState, targetMs: number): BattleState {
  const s = structuredClone(state);
  // 3 分钟上限：目标时刻再远，时间线也只推进到 startedAt + 上限
  const cap = Math.min(targetMs, s.startedAt + BATTLE_DURATION_MS);
  // 每个 advance 用当前种子重建 RNG，结束时回写状态 → 跨多次快进的确定性续跑
  const rng = createRng(s.seed);

  while (!s.over) {
    // 同刻 me 先手（排序键 (nextActAt, side: me<foe)）
    const side: "me" | "foe" = s.me.nextActAt <= s.foe.nextActAt ? "me" : "foe";
    const t = Math.min(s.me.nextActAt, s.foe.nextActAt);
    if (t > cap) break;
    const actor = s[side];
    const targetSide: "me" | "foe" = side === "me" ? "foe" : "me";
    const target = s[targetSide];

    // 昏迷：跳过本次行动，顺延到昏迷截止（结束当刻立即出手）；不消耗 RNG
    if (actor.stunUntil > t) {
      pushEvent(s, {
        t,
        side,
        kind: "stun",
        text: side === "me" ? "你被击晕，无法行动！" : `${actor.name} 被击晕，无法行动！`,
      });
      actor.nextActAt = actor.stunUntil;
      continue;
    }

    // 行动：玩家有 pendingSkill 时本次出手改为技能结算，结算后清空（下一击恢复普攻）
    const skill = side === "me" ? s.pendingSkill : null;
    resolveAttack(s, rng, t, side, skill);
    if (side === "me" && skill !== null) {
      s.pendingSkill = null; // 无论命中与否，这一击已把技能消耗掉（SP 在激活时已扣）
    }

    // 战斗内不自然回血（原版口径）：HP 恢复只发生在战斗外（按 5 秒窗口惰性补算）与药品

    // g. 推进下一次出手（仅未昏迷路径）
    actor.nextActAt += actor.intervalMs;

    // h. 死亡判定：目标血量归零即终局，循环随之终止
    if (target.hp <= 0) {
      const victory = side === "me";
      s.over = victory ? { result: "victory", expGained: s.foeExp } : { result: "defeat" };
      // 战败文案用攻方（怪物）名：锁定示例为「你被 草原蝎 击败了！」，不能用目标名（会得「你被 你 击败了」）
      pushEvent(s, {
        t,
        side,
        kind: "end",
        text: victory
          ? `你击败了 ${target.name}，获得 ${s.foeExp} 点经验！`
          : `你被 ${actor.name} 击败了！`,
      });
    }
  }

  // 快进越过 3 分钟仍无胜负 → 平局脱战（end 事件只发这一次，over 已设后不再进入）
  if (!s.over && targetMs >= s.startedAt + BATTLE_DURATION_MS) {
    s.over = { result: "draw" };
    pushEvent(s, { t: cap, side: "me", kind: "end", text: "战斗超时，不分胜负。" });
  }

  // now 单调守卫：路由层拿旧快照重放/时钟回拨时 targetMs 可能小于当前 now，只前进不回退
  s.now = Math.max(s.now, cap);
  s.seed = rng.state;
  return s;
}

// ---------- 技能激活 ----------

/**
 * 激活技能：不改时间线，只扣 SP / 进 CD / 标记待发 / 咏唱顺延出手。
 *
 * 返回值说明：规格锁定「纯函数不改入参」，而调用方（POST /skill）需要拿到扣 SP 后的
 * 新快照回写 battles.state，故 ok 分支携带新 state——这是规格签名 { ok: true } 的必要补全，
 * 否则标记结果无法传出。
 *
 * 拒绝路径（互斥，按序判定）：战斗已结束 / 已有待发技能 / CD 中 / SP 不足。
 */
export function activateSkill(
  state: BattleState,
  skill: SkillPayload & { sp: number; cdMs: number; castMs: number },
  nowMs: number,
): { ok: true; state: BattleState } | { ok: false; reason: string } {
  if (state.over !== null) {
    return { ok: false, reason: "战斗已结束" };
  }
  if (state.pendingSkill !== null) {
    return { ok: false, reason: "已有待发的技能" };
  }
  if (nowMs < state.skillCdUntil) {
    return { ok: false, reason: "技能冷却中" };
  }
  if ((state.me.sp ?? 0) < skill.sp) {
    return { ok: false, reason: "SP 不足" };
  }

  const s = structuredClone(state);
  s.me.sp = (s.me.sp ?? 0) - skill.sp;
  s.skillCdUntil = nowMs + skill.cdMs;
  // 只拷贝 payload 字段：sp/cdMs/castMs 是激活参数，不属于待发载荷
  s.pendingSkill = {
    code: skill.code,
    name: skill.name,
    kind: skill.kind,
    ...(skill.bonusDamage !== undefined ? { bonusDamage: skill.bonusDamage } : {}),
    ...(skill.dmgMin !== undefined ? { dmgMin: skill.dmgMin } : {}),
    ...(skill.dmgMax !== undefined ? { dmgMax: skill.dmgMax } : {}),
    ...(skill.stunMs !== undefined ? { stunMs: skill.stunMs } : {}),
  };
  // 咏唱：出手时刻不早于 now + castMs（火球术 5000ms 即延后 5 秒出手），只顺延不提前
  s.me.nextActAt = Math.max(s.me.nextActAt, nowMs + skill.castMs);
  return { ok: true, state: s };
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "../db.ts";
import { monsterIndex, nodeIndex, petIndex, skillIndex } from "../data/loader.ts";
import { requireCharacter } from "../plugins/auth.ts";
import { resolveCurrentNode } from "../game/node.ts";
import { spawnForNode } from "../game/spawn.ts";
import {
  activateSkill,
  advance,
  createBattleState,
  type BattleState,
} from "../game/engine.ts";
import {
  applyLevelUps,
  atkOf,
  BASE_CRIT,
  CRIT_MULT,
  defOf,
  dodgeOf,
  hpMaxOf,
  lazyRegen,
  PLAYER_ATTACK_MS,
  spMaxOf,
} from "../game/rules.ts";

/** 结算用角色行字段（battles 外键保证角色存在，读取即用） */
const CHARACTER_FIELDS =
  "id, name, profession, breed_code, level, exp, vit, str, agi, intel, spr, hp, sp, resources_updated_at, current_node_code";

interface CharacterBattleRow extends RowDataPacket {
  id: number;
  name: string;
  profession: "warrior" | "mage";
  breed_code: string;
  level: number;
  exp: number;
  vit: number;
  str: number;
  agi: number;
  intel: number;
  spr: number;
  hp: number;
  sp: number;
  resources_updated_at: Date;
  current_node_code: string | null;
}

interface BattleRow {
  id: number;
  characterId: number;
  monsterInstanceId: number;
  monsterCode: string;
  state: BattleState;
}

/** mysql2 对 JSON 列可能回传字符串或已解析对象，两种形态统一归一 */
function parseState(raw: unknown): BattleState {
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as BattleState;
}

/**
 * 品种成长系数：pets.json 按角色 breed_code 反查。
 * 静态漂移兜底：品种已删除的角色按零成长结算，不阻断战斗收尾（与视图层幽灵行消毒同口径）。
 */
function growthOf(breedCode: string): { vit: number; str: number; agi: number; intel: number; spr: number } {
  const pet = petIndex().get(breedCode);
  return pet?.growth ?? { vit: 0, str: 0, agi: 0, intel: 0, spr: 0 };
}

/** 响应态组装（三路由统一）：从 BattleState 提取前端渲染所需字段，SP 缺省时省略 */
function toResponseState(s: BattleState) {
  return {
    hp: s.me.hp,
    maxHp: s.me.maxHp,
    ...(s.me.sp !== undefined ? { sp: s.me.sp } : {}),
    ...(s.me.maxSp !== undefined ? { maxSp: s.me.maxSp } : {}),
    foeHp: s.foe.hp,
    foeMaxHp: s.foe.maxHp,
    ...(s.foe.maxSp !== undefined ? { foeMaxSp: s.foe.maxSp } : {}),
    foeName: s.foe.name, // 快照内现成有：战斗恢复/轮询时前端无需再推断怪名与形象
    foeSprite: s.foe.sprite,
    pendingSkill: s.pendingSkill,
    skillCdUntil: s.skillCdUntil,
    now: s.now,
    over: s.over,
  };
}

/** sinceSeq 查询参数解析：语义为「只回 seq > sinceSeq」；非法/缺省按 0，负数（如 -1）原样透传用于全量拉取 */
function parseSinceSeq(query: unknown): number {
  const raw = (query as { sinceSeq?: string } | undefined)?.sinceSeq;
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

/**
 * 事务内锁定角色当前 active 战斗行（单写者入口）。
 * WHERE 带 status='active' 且 FOR UPDATE：并发请求已结算时，本查询要么拿到锁后看到
 * finished（无行 → 调用方 404），要么排队到锁释放后再读——锁行与复查 active 原子完成。
 * 调用方负责事务的提交/回滚与连接释放。
 */
async function lockActiveBattle(conn: PoolConnection, characterId: number): Promise<BattleRow | null> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id, character_id, monster_instance_id, monster_code, state FROM battles
     WHERE character_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [characterId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    characterId: Number(row.character_id),
    monsterInstanceId: Number(row.monster_instance_id),
    monsterCode: row.monster_code as string,
    state: parseState(row.state),
  };
}

/** 实例复活（defeat/draw 分支共用）：回满血、清空复活排程 */
async function reviveInstance(conn: PoolConnection, instanceId: number): Promise<void> {
  await conn.query(
    "UPDATE map_node_monsters SET status = 'alive', hp = max_hp, respawn_at = NULL WHERE id = ?",
    [instanceId],
  );
}

/**
 * 结算临界区（唯一真源）：advance 已把 state 推到 over 非空，这里在同一事务内完成
 * 胜负分支副作用 + battles 落 finished。调用方必须已持有该 battle 行锁。
 * - victory：实例尸体化（30s 后复活，DB 侧算术与复活扫描同钟）；角色 applyLevelUps
 *   （hp/sp 用战斗结束快照覆盖，升级自加上限增量且恒 ≤ 新上限）；斩杀统计 UPSERT。
 * - defeat：角色回猫隐村教堂、HP/SP 按库中属性回满、恢复锚点重置；实例回满复活。
 * - draw：无得失；实例回满复活、恢复锚点重置。
 */
async function settleBattle(conn: PoolConnection, battle: BattleRow, state: BattleState): Promise<BattleState> {
  const over = state.over!;
  const result = over.result;

  if (result === "victory") {
    const expGained = over.expGained ?? state.foeExp;
    await conn.query(
      `UPDATE map_node_monsters SET status = 'dead',
         respawn_at = DATE_ADD(NOW(), INTERVAL 30 SECOND) WHERE id = ?`,
      [battle.monsterInstanceId],
    );
    const [rows] = await conn.query<CharacterBattleRow[]>(
      `SELECT ${CHARACTER_FIELDS} FROM characters WHERE id = ?`,
      [battle.characterId],
    );
    const c = rows[0];
    if (!c) throw new Error(`结算时角色不存在：${battle.characterId}`);
    const leveled = applyLevelUps(
      {
        level: c.level,
        exp: c.exp,
        vit: c.vit,
        str: c.str,
        agi: c.agi,
        intel: c.intel,
        spr: c.spr,
        hp: state.me.hp, // hp/sp 用战斗结束快照覆盖（规格锁定）
        sp: state.me.sp ?? 0,
        profession: c.profession,
        growth: growthOf(c.breed_code),
      },
      expGained,
    );
    await conn.query(
      `UPDATE characters SET level = ?, exp = ?, vit = ?, str = ?, agi = ?, intel = ?, spr = ?, hp = ?, sp = ?
       WHERE id = ?`,
      [leveled.level, leveled.exp, leveled.vit, leveled.str, leveled.agi, leveled.intel, leveled.spr,
       leveled.hp, leveled.sp, battle.characterId],
    );
    await conn.query(
      `INSERT INTO character_monster_stats (character_id, monster_code, kill_count, total_exp_gained)
       VALUES (?, ?, 1, ?) AS new
       ON DUPLICATE KEY UPDATE
         character_monster_stats.kill_count = character_monster_stats.kill_count + 1,
         character_monster_stats.total_exp_gained = character_monster_stats.total_exp_gained + new.total_exp_gained`,
      [battle.characterId, battle.monsterCode, expGained],
    );
  } else if (result === "defeat") {
    const [rows] = await conn.query<CharacterBattleRow[]>(
      "SELECT level, vit, intel FROM characters WHERE id = ?",
      [battle.characterId],
    );
    const c = rows[0];
    if (!c) throw new Error(`结算时角色不存在：${battle.characterId}`);
    await conn.query(
      `UPDATE characters SET current_node_code = 'jiaotang', hp = ?, sp = ?, resources_updated_at = NOW()
       WHERE id = ?`,
      [hpMaxOf(c.level, c.vit), spMaxOf(c.level, c.intel), battle.characterId],
    );
    await reviveInstance(conn, battle.monsterInstanceId);
  } else {
    await conn.query("UPDATE characters SET resources_updated_at = NOW() WHERE id = ?", [
      battle.characterId,
    ]);
    await reviveInstance(conn, battle.monsterInstanceId);
  }

  await conn.query(
    "UPDATE battles SET status = 'finished', result = ?, state = ?, ended_at = NOW() WHERE id = ?",
    [result, JSON.stringify(state), battle.id],
  );
  return state;
}

/** 战斗路由：发起 / 轮询 / 技能，惰性结算副作用（服务器零定时器，全部 Date.now() 驱动） */
export async function battleRoutes(app: FastifyInstance) {
  /**
   * 发起战斗。流程：锁角色行 → 解析当前格（残留未知节点惰性落库出生点，与 /map/current
   * 同语义）→ spawnForNode（玩家可能站在尚无实例的 spawns 格）→ 校验链 → lazyRegen →
   * createBattleState → INSERT battles。
   * 双行锁防双账号同点同怪：角色行锁串行化同角色开战；实例行锁配合「实例已有 active
   * 战斗」校验实现跨账号同怪互斥。实例行锁特意放在 spawnForNode 之后：spawnForNode 走
   * 独立连接，若先锁实例行，全灭格子的复活 UPDATE 会与本事务行锁互等。
   */
  app.post("/start", { preHandler: requireCharacter }, async (req, reply) => {
    const body = z.object({ monsterInstanceId: z.number().int().positive() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ message: "参数不合法" });
    const characterId = req.account!.characterId!;
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const [charRows] = await conn.query<CharacterBattleRow[]>(
        `SELECT ${CHARACTER_FIELDS} FROM characters WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
        [characterId],
      );
      const c = charRows[0];
      if (!c) {
        await conn.rollback();
        return reply.code(404).send({ message: "角色不存在" });
      }

      // 解析当前格（共享 helper：残留未知节点惰性落库猫隐村出生点，与地图路由同语义）
      const owner = nodeIndex().get(await resolveCurrentNode(conn, characterId, c.current_node_code))!;
      const ownerNodeCode = owner.node.code;

      // 先刷怪（与 /map/current 同语义；见上：先于实例行锁，避免复活 UPDATE 与行锁互等）
      await spawnForNode(owner.mapCode, ownerNodeCode);

      // 校验链 ①：已有 active 战斗 → 409
      const [busy] = await conn.query<RowDataPacket[]>(
        "SELECT id FROM battles WHERE character_id = ? AND status = 'active' LIMIT 1",
        [characterId],
      );
      if (busy[0]) {
        await conn.rollback();
        return reply.code(409).send({ message: "已有进行中的战斗", battleId: busy[0].id });
      }

      // 锁实例行（双行锁之二）
      const [instRows] = await conn.query<RowDataPacket[]>(
        `SELECT id, map_code, node_code, monster_code, hp, max_hp, status FROM map_node_monsters
         WHERE id = ? FOR UPDATE`,
        [body.data.monsterInstanceId],
      );
      const inst = instRows[0];
      // 校验链 ②：实例不存在 / 静态漂移幽灵行 / 不属于当前格 → 400（与视图层消毒同口径）
      if (!inst) {
        await conn.rollback();
        return reply.code(400).send({ message: "怪物不存在" });
      }
      const monster = monsterIndex().get(inst.monster_code as string);
      if (!monster) {
        await conn.rollback();
        return reply.code(400).send({ message: "怪物不存在" });
      }
      if (inst.map_code !== owner.mapCode || inst.node_code !== ownerNodeCode) {
        await conn.rollback();
        return reply.code(400).send({ message: "怪物不在当前格子" });
      }
      // 校验链 ③：尸体（含全灭未到复活时间，spawnForNode 不会提前复活）→ 409
      if (inst.status !== "alive") {
        await conn.rollback();
        return reply.code(409).send({ message: "怪物尚未刷新" });
      }
      // 校验链 ④：同一实例同时只允许一场战斗（跨账号同怪互斥）。
      // 必须用锁定读（FOR UPDATE）绕过 RR 读视图：本事务的快照建立于链①，若另一账号的
      // /start 在「链①之后、本事务拿到实例行锁之前」提交，一致读将看不见其新 battles 行，
      // 会漏放两场同实例战斗；锁定读恒读最新已提交数据，而能拿到实例行锁即意味着对方已提交
      // （与链②对同行实例的重复加锁无碍，同事务内锁幂等）。
      const [foeBusy] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM battles WHERE monster_instance_id = ? AND status = 'active' LIMIT 1
         FOR UPDATE`,
        [inst.id],
      );
      if (foeBusy[0]) {
        await conn.rollback();
        return reply.code(409).send({ message: "该怪物正在被挑战" });
      }

      // 惰性恢复：DB 读 hp/sp/锚点 → 计算回写，恢复锚点推进到 now（统一 Date.now()）
      const now = Date.now();
      const maxHp = hpMaxOf(c.level, c.vit);
      const maxSp = spMaxOf(c.level, c.intel);
      const regen = lazyRegen(
        {
          hp: c.hp,
          sp: c.sp,
          maxHp,
          maxSp,
          spr: c.spr,
          intel: c.intel,
          resourcesUpdatedAt: new Date(c.resources_updated_at).getTime(),
        },
        now,
      );
      await conn.query(
        "UPDATE characters SET hp = ?, sp = ?, resources_updated_at = ? WHERE id = ?",
        [regen.hp, regen.sp, new Date(now), characterId],
      );

      // 怪侧：hp/max_hp 取实例行权威值（绝不从静态数据重派生）；攻击在静态区间内
      // 开战时随机定型（与刷怪 HP roll 同口径），定型后随快照持久化；战斗内双方均不自然回血（原版口径）
      const foeAtk = monster.atkMin + Math.floor(Math.random() * (monster.atkMax - monster.atkMin + 1));
      const state = createBattleState(
        {
          me: {
            name: c.name,
            sprite: "", // 形象交 Task 7 前端覆盖层处理
            level: c.level,
            hp: regen.hp,
            maxHp,
            sp: regen.sp,
            maxSp,
            atk: atkOf(c.profession, c.str, c.intel),
            def: defOf(c.agi),
            dodge: dodgeOf(c.agi),
            crit: BASE_CRIT,
            critMult: CRIT_MULT,
            intervalMs: PLAYER_ATTACK_MS[c.profession],
          },
          foe: {
            name: monster.name,
            sprite: monster.sprite,
            level: monster.level,
            hp: Number(inst.hp),
            maxHp: Number(inst.max_hp),
            atk: foeAtk,
            def: monster.def,
            dodge: monster.dodgeRate,
            crit: monster.critRate,
            critMult: CRIT_MULT,
            intervalMs: monster.intervalMs,
          },
          foeExp: monster.exp,
        },
        Math.floor(Math.random() * 0x100000000) >>> 0,
        now,
      );

      await conn.query(
        `INSERT INTO battles (character_id, monster_instance_id, monster_code, status, state, started_at)
         VALUES (?, ?, ?, 'active', ?, ?)`,
        [characterId, inst.id, inst.monster_code, JSON.stringify(state), new Date(now)],
      );
      await conn.commit();
      return { state: toResponseState(state), events: [] };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  /**
   * 轮询推进：读 active 战斗 → advance(Date.now()) → 未结束回写快照；
   * 已分胜负走结算临界区（victory/defeat/draw 副作用见 settleBattle）。
   * 无 active 战斗返回 404（前端据此关闭战斗覆盖层）。
   */
  app.get("/state", { preHandler: requireCharacter }, async (req, reply) => {
    const characterId = req.account!.characterId!;
    const sinceSeq = parseSinceSeq(req.query);
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const battle = await lockActiveBattle(conn, characterId);
      if (!battle) {
        await conn.rollback();
        return reply.code(404).send({ message: "当前没有进行中的战斗" });
      }
      const now = Date.now();
      // 顺序固定：先 advance 再分支；over 后 advance 是安全 no-op（终局只结算一次由行锁保证）
      const next = advance(battle.state, now);
      let finalState: BattleState;
      if (next.over !== null) {
        finalState = await settleBattle(conn, battle, next);
      } else {
        await conn.query("UPDATE battles SET state = ? WHERE id = ?", [JSON.stringify(next), battle.id]);
        finalState = next;
      }
      await conn.commit();
      return {
        state: toResponseState(finalState),
        events: finalState.events.filter((e) => e.seq > sinceSeq),
      };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  /**
   * 技能激活：读 active 战斗 → 校验技能（MVP 口径：preset 技能按职业直接可用，不查
   * character_skills，切片 5+ 接技能学习后替换）→ 先 advance（若这一下打出胜负则直接
   * 结算并返回，不再激活）→ activateSkill（扣 SP/进 CD/标记待发/咏唱顺延）→ 回写快照。
   * 激活被拒时回滚：advance 无副作用写入，快照确定性保证下次轮询重算出同一时间线。
   */
  app.post("/skill", { preHandler: requireCharacter }, async (req, reply) => {
    const body = z.object({ code: z.string().min(1).max(64) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ message: "参数不合法" });
    const characterId = req.account!.characterId!;
    const sinceSeq = parseSinceSeq(req.query);
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const battle = await lockActiveBattle(conn, characterId);
      if (!battle) {
        await conn.rollback();
        return reply.code(404).send({ message: "当前没有进行中的战斗" });
      }
      const skill = skillIndex().get(body.data.code);
      const [pRows] = await conn.query<RowDataPacket[]>(
        "SELECT profession FROM characters WHERE id = ?",
        [characterId],
      );
      const profession = pRows[0]?.profession as string | undefined;
      if (!skill || skill.profession !== profession) {
        await conn.rollback();
        return reply.code(400).send({ message: "技能不存在或职业不符" });
      }

      const now = Date.now();
      // 集成纪律：先 advance 再激活（先激活会吞掉 now 前应发生的一次普攻）
      const advanced = advance(battle.state, now);
      if (advanced.over !== null) {
        // 这一击打出胜负：走结算临界区并返回，不再激活
        const finalState = await settleBattle(conn, battle, advanced);
        await conn.commit();
        return {
          state: toResponseState(finalState),
          events: finalState.events.filter((e) => e.seq > sinceSeq),
        };
      }
      const r = activateSkill(
        advanced,
        {
          code: skill.code,
          name: skill.name,
          kind: skill.kind,
          bonusDamage: skill.kind === "next_hit_bonus" ? skill.bonusDamage : undefined,
          dmgMin: skill.kind === "direct_damage" ? skill.dmgMin : undefined,
          dmgMax: skill.kind === "direct_damage" ? skill.dmgMax : undefined,
          sp: skill.spCost,
          cdMs: skill.cdMs,
          castMs: skill.castMs,
        },
        now,
      );
      if (!r.ok) {
        await conn.rollback();
        return reply.code(400).send({ message: r.reason });
      }
      await conn.query("UPDATE battles SET state = ? WHERE id = ?", [JSON.stringify(r.state), battle.id]);
      await conn.commit();
      return { state: toResponseState(r.state), events: r.state.events.filter((e) => e.seq > sinceSeq) };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "../db.ts";
import { itemIndex } from "../data/loader.ts";
import { requireCharacter } from "../plugins/auth.ts";
import {
  BAG_SLOTS,
  EQUIP_SLOT_CODES,
  firstFreeSlot,
  planEquip,
  type BagRow,
  type EquipSlotCode,
} from "../game/inventory.ts";
import { equipmentBonusesOf } from "../game/equipment.ts";
import { playerCombatOf } from "../game/engine.ts";
import { hpMaxOf, lazyRegen, spMaxOf } from "../game/rules.ts";

/** 背包行（character_inventory 行的最小投影） */
interface InvRow extends RowDataPacket {
  id: number;
  item_code: string;
  slot_index: number | null;
  quantity: number;
  durability: number | null;
}

/** 穿戴行（character_equipment join character_inventory；slot_index 恒 NULL） */
interface EquipJoinRow extends RowDataPacket {
  slot_code: string;
  id: number;
  item_code: string;
  slot_index: number | null;
  quantity: number;
  durability: number | null;
}

/** 写路由共用的角色行（锁角色行读一次带齐校验字段） */
interface CharacterRow extends RowDataPacket {
  id: number;
  level: number;
  profession: "warrior" | "mage";
  vit: number;
  intel: number;
  spr: number;
  hp: number;
  sp: number;
  resources_updated_at: Date;
}

/** GET 视图角色行：copper + combat 块所需的职业与基础五维 */
interface ViewCharacterRow extends RowDataPacket {
  copper: number;
  profession: "warrior" | "mage";
  str: number;
  agi: number;
  intel: number;
}

const CHARACTER_LOCK_FIELDS =
  "id, level, profession, vit, intel, spr, hp, sp, resources_updated_at";

/** 锁角色行（写路由纪律第一步）：不存在（含软删）回 null，调用方负责回滚后回 404 */
async function lockCharacter(
  conn: PoolConnection,
  characterId: number,
): Promise<CharacterRow | null> {
  const [rows] = await conn.query<CharacterRow[]>(
    `SELECT ${CHARACTER_LOCK_FIELDS} FROM characters WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
    [characterId],
  );
  return rows[0] ?? null;
}

/** 视图层的背包行投影（brief Interfaces 锁定的 BagItemView） */
function toBagItemView(row: {
  id: number;
  item_code: string;
  slot_index: number | null;
  quantity: number;
  durability: number | null;
}) {
  const it = itemIndex().get(row.item_code);
  const isEquip = it?.kind === "equipment";
  return {
    inventoryId: Number(row.id),
    itemCode: row.item_code,
    slotIndex: row.slot_index == null ? null : Number(row.slot_index),
    quantity: Number(row.quantity),
    durability: row.durability == null ? null : Number(row.durability),
    // 静态漂移兜底（Review Focus #1）：未知 code 按占位材料渲染，不阻断视图
    name: it?.name ?? row.item_code,
    quality: it?.kind === "equipment" ? it.quality : "",
    sprite: it?.sprite ?? "",
    desc: it?.desc ?? "",
    kind: it?.kind ?? "material",
    stackMax: it && it.kind !== "equipment" ? it.stackMax : 1,
    // 仅装备带 equip 子对象（可选字段 undefined 在 JSON 序列化时省略）
    ...(isEquip
      ? {
          equip: {
            slot: it.slot,
            equipType: it.equipType,
            hands: it.hands,
            levelReq: it.levelReq,
            durabilityMax: it.durabilityMax, // 详情窗「耐久 x/y」的分母
            dmgMin: it.dmgMin,
            dmgMax: it.dmgMax,
            intervalMs: it.intervalMs,
            defBonus: it.defBonus,
            bonuses: it.bonuses,
          },
        }
      : {}),
  };
}

/** 背包路由：GET 视图 / 穿戴 / 卸下 / 用药 / 丢弃（写路由事务内先锁角色行互斥） */
export async function inventoryRoutes(app: FastifyInstance) {
  /**
   * 背包视图：bag 仅未穿戴行（按 slotIndex 升序）、equipment 为 14 栏位全量键记录、
   * bonuses 为 equipmentBonusesOf 原样输出（dmgMin/dmgMax/intervalMs null=无有效武器）、
   * combat 为宠物窗战斗属性块（engine.playerCombatOf 组装，与开战并装同源）。
   * 静态字段从 itemIndex() 取，未知 code 兜底占位材料（静态数据漂移不阻断渲染）。
   */
  app.get("/", { preHandler: requireCharacter }, async (req) => {
    const characterId = req.account!.characterId!;
    const pool = getPool();
    const [invRows] = await pool.query<InvRow[]>(
      `SELECT id, item_code, slot_index, quantity, durability FROM character_inventory
       WHERE character_id = ?`,
      [characterId],
    );
    const [eqRows] = await pool.query<EquipJoinRow[]>(
      `SELECT e.slot_code, i.id, i.item_code, i.slot_index, i.quantity, i.durability
       FROM character_equipment e JOIN character_inventory i ON i.id = e.inventory_id
       WHERE e.character_id = ?`,
      [characterId],
    );
    const [charRows] = await pool.query<ViewCharacterRow[]>(
      "SELECT copper, profession, str, agi, intel FROM characters WHERE id = ?",
      [characterId],
    );

    const equipment = Object.fromEntries(EQUIP_SLOT_CODES.map((s) => [s, null])) as Record<
      EquipSlotCode,
      ReturnType<typeof toBagItemView> | null
    >;
    const equippedRows = eqRows.map((r) => ({
      slotCode: r.slot_code,
      itemCode: r.item_code,
      durability: r.durability == null ? null : Number(r.durability),
    }));
    for (const r of eqRows) {
      equipment[r.slot_code as EquipSlotCode] = toBagItemView(r);
    }
    const bag = invRows
      .filter((r) => r.slot_index != null)
      .sort((a, b) => Number(a.slot_index) - Number(b.slot_index)) // slotIndex 升序
      .map(toBagItemView);

    const bonuses = equipmentBonusesOf(equippedRows, (code) => itemIndex().get(code));
    // combat 块（宠物窗战斗属性表数据源）：与 routes/battle.ts /start 的开战并装共用
    // engine.playerCombatOf 同一组装处（有效五维 → rules 公式、无武器兜底徒手、攻速职业默认、
    // 暴击 BASE_CRIT），口径恒同源，禁止在面板或路由复刻公式
    const c = charRows[0];
    const combat = playerCombatOf(
      c?.profession ?? "warrior",
      // 有效五维 = 基础 + 装备加成（与 battle.ts 的 strEff/agiEff/intelEff 同构）
      {
        str: Number(c?.str ?? 0) + bonuses.str,
        agi: Number(c?.agi ?? 0) + bonuses.agi,
        intel: Number(c?.intel ?? 0) + bonuses.intel,
      },
      bonuses,
    );

    return {
      copper: Number(c?.copper ?? 0),
      bag,
      equipment,
      bonuses,
      combat: {
        dmgMin: combat.dmgMin,
        dmgMax: combat.dmgMax,
        intervalMs: combat.intervalMs,
        atk: combat.atk,
        def: combat.def,
        critRate: combat.crit,
      },
    };
  });

  /**
   * 穿戴：planEquip 纯校验（等级/职业/替换联动/背包空位）→ 按腾格顺序落库：
   * ① 新装备行置 NULL（其原格即刻空闲）② 回包件逐件 firstFreeSlot 重算分配
   * ③ equipment UPSERT（uk (character_id, slot_code)，替换时原行原地改指新件）
   * ④ 被替换件（含双手/副手联动卸下件）的 equipment 行 DELETE。
   * 满包替换天然成功（①腾出的格 ≥ 回包件数，规格决策 7）。
   */
  app.post("/equip", { preHandler: requireCharacter }, async (req, reply) => {
    const body = z.object({ inventoryId: z.number().int().positive() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ message: "参数不合法" });
    const characterId = req.account!.characterId!;
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const c = await lockCharacter(conn, characterId);
      if (!c) {
        await conn.rollback();
        return reply.code(404).send({ message: "角色不存在" });
      }
      const [invRows] = await conn.query<InvRow[]>(
        `SELECT id, item_code, slot_index, quantity, durability FROM character_inventory
         WHERE id = ? AND character_id = ? FOR UPDATE`,
        [body.data.inventoryId, characterId],
      );
      const row = invRows[0];
      if (!row) {
        await conn.rollback();
        return reply.code(404).send({ message: "背包中没有该物品" });
      }
      if (row.slot_index == null) {
        await conn.rollback();
        return reply.code(400).send({ message: "该物品已在穿戴中" });
      }
      const item = itemIndex().get(row.item_code);
      if (!item) {
        await conn.rollback();
        return reply.code(400).send({ message: "物品不存在" }); // 静态漂移兜底
      }

      // 背包行 + 穿戴行锁定读（与视图/结算同口径；bagFreeSlots = 300 - 背包行数）
      const [bagRows] = await conn.query<InvRow[]>(
        `SELECT id, item_code, slot_index, quantity, durability FROM character_inventory
         WHERE character_id = ? AND slot_index IS NOT NULL FOR UPDATE`,
        [characterId],
      );
      const bag: BagRow[] = bagRows.map((r) => ({
        id: Number(r.id),
        itemCode: r.item_code,
        slotIndex: Number(r.slot_index),
        quantity: Number(r.quantity),
      }));
      const [eqRows] = await conn.query<RowDataPacket[]>(
        `SELECT e.slot_code, e.inventory_id, i.item_code FROM character_equipment e
         JOIN character_inventory i ON i.id = e.inventory_id
         WHERE e.character_id = ? FOR UPDATE`,
        [characterId],
      );
      const equipped = eqRows.map((r) => ({
        slotCode: r.slot_code as EquipSlotCode,
        inventoryId: Number(r.inventory_id),
        itemCode: r.item_code as string,
      }));

      const plan = planEquip(
        item,
        body.data.inventoryId,
        { level: Number(c.level), profession: c.profession },
        equipped,
        (code) => itemIndex().get(code),
        BAG_SLOTS - bag.length,
      );
      if (!plan.ok) {
        await conn.rollback();
        return reply.code(400).send({ message: plan.reason }); // reason 直传
      }

      // ① 新装备离包（其原格即刻空闲）
      await conn.query("UPDATE character_inventory SET slot_index = NULL WHERE id = ?", [
        body.data.inventoryId,
      ]);
      // ② 回包件逐件重算 firstFreeSlot 分配空格（工作集含新装备原格的腾出）
      const work: BagRow[] = bag.filter((r) => r.id !== body.data.inventoryId);
      for (const id of plan.unequipInventoryIds) {
        const slot = firstFreeSlot(work);
        if (slot === null) {
          await conn.rollback();
          return reply.code(400).send({ message: "背包空间不足" });
        }
        work.push({ id, itemCode: "", slotIndex: slot, quantity: 1 });
        await conn.query("UPDATE character_inventory SET slot_index = ? WHERE id = ?", [slot, id]);
      }
      // ③ equipment UPSERT（uk (character_id, slot_code)）
      await conn.query(
        `INSERT INTO character_equipment (character_id, slot_code, inventory_id)
         VALUES (?, ?, ?) AS new
         ON DUPLICATE KEY UPDATE inventory_id = new.inventory_id`,
        [characterId, plan.targetSlot, body.data.inventoryId],
      );
      // ④ 被替换件的 equipment 行 DELETE（主手替换时该行已被 ③ 原地改指，此删除为 no-op；
      //    双手/副手联动件的独立行在此清除）
      if (plan.unequipInventoryIds.length > 0) {
        const placeholders = plan.unequipInventoryIds.map(() => "?").join(", ");
        await conn.query(
          `DELETE FROM character_equipment WHERE character_id = ? AND inventory_id IN (${placeholders})`,
          [characterId, ...plan.unequipInventoryIds],
        );
      }
      await conn.commit();
      return { ok: true };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  /** 卸下：firstFreeSlot 无空格 400（脱下净 +1 格）；否则背包行落格 + equipment 行删除 */
  app.post("/unequip", { preHandler: requireCharacter }, async (req, reply) => {
    const body = z.object({ slotCode: z.enum(EQUIP_SLOT_CODES) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ message: "参数不合法" });
    const characterId = req.account!.characterId!;
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const c = await lockCharacter(conn, characterId);
      if (!c) {
        await conn.rollback();
        return reply.code(404).send({ message: "角色不存在" });
      }
      const [eqRows] = await conn.query<RowDataPacket[]>(
        "SELECT inventory_id FROM character_equipment WHERE character_id = ? AND slot_code = ? FOR UPDATE",
        [characterId, body.data.slotCode],
      );
      const eq = eqRows[0];
      if (!eq) {
        await conn.rollback();
        return reply.code(404).send({ message: "该部位没有装备" });
      }
      const [bagRows] = await conn.query<InvRow[]>(
        `SELECT id, item_code, slot_index, quantity, durability FROM character_inventory
         WHERE character_id = ? AND slot_index IS NOT NULL FOR UPDATE`,
        [characterId],
      );
      const slot = firstFreeSlot(
        bagRows.map((r) => ({
          id: Number(r.id),
          itemCode: r.item_code,
          slotIndex: Number(r.slot_index),
          quantity: Number(r.quantity),
        })),
      );
      if (slot === null) {
        await conn.rollback();
        return reply.code(400).send({ message: "背包已满" });
      }
      await conn.query("UPDATE character_inventory SET slot_index = ? WHERE id = ?", [
        slot,
        Number(eq.inventory_id),
      ]);
      await conn.query("DELETE FROM character_equipment WHERE character_id = ? AND slot_code = ?", [
        characterId,
        body.data.slotCode,
      ]);
      await conn.commit();
      return { ok: true };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  /**
   * 用药：active 战斗 409；非消耗品 400；hp/sp 并入口径 = MIN(基础上限, 惰性补算后当前 + 回复)
   * （characters 列恒基础上限口径；先 lazyRegen 补算挂机恢复再并入，锚点随本次结算推进，
   * 与 CLAUDE.md「战斗外恢复按 resources_updated_at 时间差惰性补算」不变量一致）；
   * quantity -1，归零删行。
   */
  app.post("/use", { preHandler: requireCharacter }, async (req, reply) => {
    const body = z.object({ inventoryId: z.number().int().positive() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ message: "参数不合法" });
    const characterId = req.account!.characterId!;
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const c = await lockCharacter(conn, characterId);
      if (!c) {
        await conn.rollback();
        return reply.code(404).send({ message: "角色不存在" });
      }
      const [busy] = await conn.query<RowDataPacket[]>(
        "SELECT id FROM battles WHERE character_id = ? AND status = 'active' LIMIT 1",
        [characterId],
      );
      if (busy[0]) {
        await conn.rollback();
        return reply.code(409).send({ message: "战斗中无法使用物品" });
      }
      const [invRows] = await conn.query<InvRow[]>(
        `SELECT id, item_code, slot_index, quantity, durability FROM character_inventory
         WHERE id = ? AND character_id = ? FOR UPDATE`,
        [body.data.inventoryId, characterId],
      );
      const row = invRows[0];
      if (!row) {
        await conn.rollback();
        return reply.code(404).send({ message: "背包中没有该物品" });
      }
      const item = itemIndex().get(row.item_code);
      if (!item || item.kind !== "consumable") {
        await conn.rollback();
        return reply.code(400).send({ message: "只有消耗品可以使用" });
      }

      // 惰性补算挂机恢复（锚点推进到 now，统一 Date.now()），回复并入后按基础上限 clamp
      const now = Date.now();
      const maxHp = hpMaxOf(Number(c.level), Number(c.vit));
      const maxSp = spMaxOf(Number(c.level), Number(c.intel));
      const regen = lazyRegen(
        {
          hp: Number(c.hp),
          sp: Number(c.sp),
          maxHp,
          maxSp,
          spr: Number(c.spr),
          intel: Number(c.intel),
          resourcesUpdatedAt: new Date(c.resources_updated_at).getTime(),
        },
        now,
      );
      const hp = Math.min(maxHp, regen.hp + (item.effect.hp ?? 0));
      const sp = Math.min(maxSp, regen.sp + (item.effect.sp ?? 0));
      await conn.query(
        "UPDATE characters SET hp = ?, sp = ?, resources_updated_at = ? WHERE id = ?",
        [hp, sp, new Date(now), characterId],
      );
      // 扣减一次用量，归零删行
      if (Number(row.quantity) <= 1) {
        await conn.query("DELETE FROM character_inventory WHERE id = ?", [row.id]);
      } else {
        await conn.query("UPDATE character_inventory SET quantity = quantity - 1 WHERE id = ?", [
          row.id,
        ]);
      }
      await conn.commit();
      return { hp, sp };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  /** 丢弃：已穿戴（slot_index NULL）400；整堆删行；带 quantity 按 GREATEST(0, ...) 归零删行 */
  app.post("/discard", { preHandler: requireCharacter }, async (req, reply) => {
    const body = z
      .object({
        inventoryId: z.number().int().positive(),
        quantity: z.number().int().positive().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ message: "参数不合法" });
    const characterId = req.account!.characterId!;
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const c = await lockCharacter(conn, characterId);
      if (!c) {
        await conn.rollback();
        return reply.code(404).send({ message: "角色不存在" });
      }
      const [invRows] = await conn.query<InvRow[]>(
        `SELECT id, item_code, slot_index, quantity, durability FROM character_inventory
         WHERE id = ? AND character_id = ? FOR UPDATE`,
        [body.data.inventoryId, characterId],
      );
      const row = invRows[0];
      if (!row) {
        await conn.rollback();
        return reply.code(404).send({ message: "背包中没有该物品" });
      }
      if (row.slot_index == null) {
        await conn.rollback();
        return reply.code(400).send({ message: "已穿戴的装备不能丢弃" });
      }
      if (body.data.quantity === undefined || Number(row.quantity) <= body.data.quantity) {
        // 整堆丢弃（或丢弃量 ≥ 存量）：直接删行
        await conn.query("DELETE FROM character_inventory WHERE id = ?", [row.id]);
      } else {
        await conn.query(
          "UPDATE character_inventory SET quantity = GREATEST(0, quantity - ?) WHERE id = ?",
          [body.data.quantity, row.id],
        );
      }
      await conn.commit();
      return { ok: true };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });
}

import type { Item } from "../data/schemas.ts";

/** 运行时装备行（db equipped_items 行的最小投影；耐久 null=无耐久计量的部位） */
export interface EquippedRow {
  slotCode: string;       // 运行时栏位（ring1/ring2…）
  itemCode: string;
  durability: number | null;
}

export interface EquipmentBonuses {
  vit: number; str: number; agi: number; intel: number; spr: number; // 五维加成（开战时并入派生属性）
  hp: number; sp: number;
  atk: number;            // 原版「攻击:+N」词条汇总（蓝宝书武器带，如能量之卷刃剑 +2），开战时直接加 atk
  def: number;            // defBonus 汇总
  dmgMin: number | null;  // 主手武器区间（无武器/耐久0 → null）
  dmgMax: number | null;
  intervalMs: number | null; // 主手武器攻速（无武器/耐久0 → null，用职业默认）
}

/**
 * 装备加成汇总（纯函数）：五维/hp/sp/atk 从 bonuses 逐项累加，def 累加 defBonus ?? 0；
 * 主手武器行（slot === "main_hand" 且耐久非 0）取 dmgMin/dmgMax/intervalMs
 * （schema 已锁只有 main_hand 带这些字段，副手无需特判；多主手行不合法，首个生效）。
 * 耐久 0 或静态漂移（物品不存在/非装备）的行整体跳过——属性失效但不消失，不抛错。
 */
export function equipmentBonusesOf(
  rows: EquippedRow[],
  itemByCode: (code: string) => Item | undefined,
): EquipmentBonuses {
  const out: EquipmentBonuses = {
    vit: 0, str: 0, agi: 0, intel: 0, spr: 0, hp: 0, sp: 0, atk: 0, def: 0,
    dmgMin: null, dmgMax: null, intervalMs: null,
  };
  for (const row of rows) {
    if (row.durability === 0) continue; // 耐久 0：整件失效
    const it = itemByCode(row.itemCode);
    if (it?.kind !== "equipment") continue; // 静态漂移：不存在/非装备，跳过
    const b = it.bonuses;
    out.vit += b.vit ?? 0;
    out.str += b.str ?? 0;
    out.agi += b.agi ?? 0;
    out.intel += b.intel ?? 0;
    out.spr += b.spr ?? 0;
    out.hp += b.hp ?? 0;
    out.sp += b.sp ?? 0;
    out.atk += b.atk ?? 0;
    out.def += it.defBonus ?? 0;
    if (it.slot === "main_hand" && out.dmgMin === null) {
      out.dmgMin = it.dmgMin ?? null;
      out.dmgMax = it.dmgMax ?? null;
      out.intervalMs = it.intervalMs ?? null;
    }
  }
  return out;
}

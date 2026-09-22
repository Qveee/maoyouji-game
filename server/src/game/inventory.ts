import type { Item } from "../data/schemas.ts";
import type { LootItem } from "./drops.ts";
import { itemIndex } from "../data/loader.ts";

/** 背包格数（原版口径 300 格） */
export const BAG_SLOTS = 300;

/** 运行时装备栏位（静态 ring 拆两栏，共 14） */
export const EQUIP_SLOT_CODES = [
  "main_hand", "off_hand", "head", "shoulder", "chest", "hands", "waist",
  "legs", "feet", "wrist", "ring1", "ring2", "neck", "cloak",
] as const;
export type EquipSlotCode = (typeof EQUIP_SLOT_CODES)[number];

/** 背包行（db 行的最小投影；slotIndex null=已穿戴不出现在 bag 参数里） */
export interface BagRow {
  id: number;
  itemCode: string;
  slotIndex: number;
  quantity: number;
}

/** stackMaxOf：物品 code → 堆叠上限（装备恒 1；未知 code 按 1 兜底=永不堆叠，静态漂移安全） */
export type StackMaxOf = (itemCode: string) => number;

export interface StackAdd { id: number; quantity: number }          // 往已有堆加量
export interface NewStack { itemCode: string; slotIndex: number; quantity: number; durabilityMax: number | null } // 开新格（装备 durabilityMax 非空供 db 层写 durability）
export interface LostItem { itemCode: string; qty: number }

/**
 * 新开格的耐久上限：真实装备取静态 durabilityMax（供 db 层直接写入满耐久）。
 * lootInto 签名只收 stackMaxOf，物品明细经 loader 的 itemIndex() 模块级缓存补齐
 * （同 spawn.ts / node.ts 直用 loader 的既有惯例）；code 查不到（单测合成码/静态漂移）
 * 但按不可堆处理（stackMax===1）时兜底 1，可堆物为 null。
 */
function durabilityMaxOf(code: string, stackMax: number): number | null {
  const it = itemIndex().get(code);
  if (it?.kind === "equipment") return it.durabilityMax;
  return stackMax === 1 ? 1 : null;
}

/**
 * 把掉落依序装入背包：先填同码未满堆（从低 slot 行开始），再开最小空闲格。
 * 全程不改入参；放不下的进 lost（整段数量，不拆分丢弃——单次掉落条目要么全进要么全丢）。
 * stackAdds 只指向调用前已存在的行（id 为 db 真实 id）；本次调用新开的格之间互相堆叠
 * 时直接并进对应 newStacks.quantity，不产出 id=0 的假 StackAdd（防 db 层 UPDATE 空转丢物）。
 */
export function lootInto(
  bag: BagRow[],
  loot: LootItem[],
  stackMaxOf: StackMaxOf,
): { stackAdds: StackAdd[]; newStacks: NewStack[]; lost: LostItem[] } {
  // 工作副本：slotIndex → 行（深拷贝行对象，不改入参）
  const work = new Map<number, BagRow>();
  for (const r of bag) work.set(r.slotIndex, { ...r });
  // 本次调用新开的格：slotIndex → 对应 newStacks 条目（后续掉落条目堆上去时并量）
  const opened = new Map<number, NewStack>();

  const stackAdds: StackAdd[] = [];
  const newStacks: NewStack[] = [];
  const lost: LostItem[] = [];

  for (const entry of loot) {
    let remaining = entry.qty;
    // 兜底 ≥1：回调异常返回 ≤0 时按不可堆处理，防开格 while 循环不推进（put=0 死循环）
    const max = Math.max(1, stackMaxOf(entry.itemCode));

    // ① 先填同码未满堆（按 slot 升序）
    if (max > 1) {
      const fillable = [...work.values()]
        .filter((r) => r.itemCode === entry.itemCode && r.quantity < max)
        .sort((a, b) => a.slotIndex - b.slotIndex);
      for (const r of fillable) {
        if (remaining <= 0) break;
        const add = Math.min(max - r.quantity, remaining);
        r.quantity += add;
        remaining -= add;
        const fresh = opened.get(r.slotIndex);
        if (fresh) {
          fresh.quantity += add; // 堆到本次新开的格上：并入 newStacks，不出假 StackAdd
        } else {
          stackAdds.push({ id: r.id, quantity: add });
        }
      }
    }

    // ② 再开最小空闲格
    while (remaining > 0) {
      const slot = firstFreeSlot([...work.values()]);
      if (slot === null) {
        lost.push({ itemCode: entry.itemCode, qty: remaining }); // 包满：整段丢弃，不拆分
        break;
      }
      const put = Math.min(max, remaining);
      const stack: NewStack = {
        itemCode: entry.itemCode,
        slotIndex: slot,
        quantity: put,
        durabilityMax: durabilityMaxOf(entry.itemCode, max),
      };
      work.set(slot, { id: 0, itemCode: entry.itemCode, slotIndex: slot, quantity: put });
      opened.set(slot, stack);
      newStacks.push(stack);
      remaining -= put;
    }
  }

  return { stackAdds, newStacks, lost };
}

/** 第一个空闲格（0 起）；满返回 null */
export function firstFreeSlot(bag: BagRow[]): number | null {
  const occupied = new Set(bag.map((r) => r.slotIndex));
  for (let slot = 0; slot < BAG_SLOTS; slot++) {
    if (!occupied.has(slot)) return slot;
  }
  return null;
}

export type EquipPlan =
  | { ok: true; targetSlot: EquipSlotCode; unequipInventoryIds: number[] }
  | { ok: false; reason: string };

/**
 * 穿戴计划（纯校验+替换联动，不落库）：
 * - 等级/职业不符 → 拒绝；耐久 0 允许穿（属性失效由 equipment.ts 处理）
 * - 目标部位占用 → 直接替换（旧装备回包）；戒指优先 ring1 再 ring2，都满替换 ring1
 * - 穿双手武器 → 副手占用则一并卸下；穿副手 → 主手是双手武器则一并卸下
 * - 不做背包空位校验：被穿装备必来自背包，离包即腾格，任何替换净占用 ≤ 0（规格决策 7
 *   二次修订「替换永可行」）；「腾格」由路由层执行顺序保证（先置 NULL 再给回包件分配格）
 *
 * inventoryId 仅供路由层定位被穿的背包行，计划结果本身用不到。
 */
export function planEquip(
  item: Item,
  inventoryId: number,
  character: { level: number; profession: "warrior" | "mage" },
  equipped: { slotCode: EquipSlotCode; inventoryId: number; itemCode: string }[],
  itemByCode: (code: string) => Item | undefined,
): EquipPlan {
  if (item.kind !== "equipment") return { ok: false, reason: "只有装备可以穿戴" };

  // 等级/职业校验（profession null=通用）；耐久不在此校验（0 耐久允许穿，属性失效由 equipment.ts 处理）
  if (item.levelReq > character.level) {
    return { ok: false, reason: `装备需要等级 ${item.levelReq}` };
  }
  if (item.profession !== null && item.profession !== character.profession) {
    return { ok: false, reason: `该装备限${item.profession === "warrior" ? "战士" : "法师"}使用` };
  }

  const bySlot = new Map(equipped.map((e) => [e.slotCode, e] as const));

  // 目标栏位：静态 slot 直接对应；戒指拆 ring1/ring2（优先 ring1，再 ring2，都满替换 ring1）
  let targetSlot: EquipSlotCode;
  if (item.slot === "ring") {
    targetSlot = bySlot.has("ring1") ? (bySlot.has("ring2") ? "ring1" : "ring2") : "ring1";
  } else {
    targetSlot = item.slot;
  }

  // 替换联动：目标部位旧件 + 双手/副手互斥件，全部回包（离包即腾格，替换永可行）
  const unequipInventoryIds: number[] = [];
  const target = bySlot.get(targetSlot);
  if (target) unequipInventoryIds.push(target.inventoryId);

  if (item.slot === "main_hand" && item.hands === 2) {
    const off = bySlot.get("off_hand");
    if (off) unequipInventoryIds.push(off.inventoryId);
  }
  if (item.slot === "off_hand") {
    const main = bySlot.get("main_hand");
    const mainItem = main ? itemByCode(main.itemCode) : undefined;
    // 查不到（静态漂移）按非双手处理
    if (main && mainItem?.kind === "equipment" && mainItem.hands === 2) {
      unequipInventoryIds.push(main.inventoryId);
    }
  }

  return { ok: true, targetSlot, unequipInventoryIds };
}

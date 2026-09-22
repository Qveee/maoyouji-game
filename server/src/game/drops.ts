import type { Rng } from "./rng.ts";
import type { MonsterDrops } from "../data/schemas.ts";

/** 单件掉落物：静态物品 code + 数量 */
export interface LootItem {
  itemCode: string;
  qty: number;
}

/** 一次击杀的掉落结果：铜币 + 物品列表（按命中顺序） */
export interface LootResult {
  copper: number;
  items: LootItem[];
}

/**
 * 掷一次击杀掉落。RNG 消耗顺序锁定（结算可复现性的契约，勿改）：
 * ① copper 恰好掷 1 次 int(copper[0], copper[1])（min===max 也掷）；
 * ② items 按表序逐条：先 1 掷 chance（next() < chance 即命中），命中后无论数量区间
 *    是否退化都再掷 1 次 qty（int(qtyMin, qtyMax)）。未命中只消耗 chance 那一掷。
 */
export function rollDrops(drops: MonsterDrops, rng: Rng): LootResult {
  const result: LootResult = { copper: rng.int(drops.copper[0], drops.copper[1]), items: [] };
  for (const entry of drops.items) {
    if (rng.next() >= entry.chance) continue; // chance 判定未命中
    result.items.push({
      itemCode: entry.item,
      qty: rng.int(entry.qtyMin, entry.qtyMax),
    });
  }
  return result;
}

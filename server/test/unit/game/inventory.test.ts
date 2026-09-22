import { describe, expect, it } from "vitest";
import { lootInto, firstFreeSlot, planEquip, BAG_SLOTS, type BagRow } from "../../../src/game/inventory.ts";
import type { Item } from "../../../src/data/schemas.ts";

const stackable = (code: string) => 99; // 测试里所有 code 都按可堆 99（装备用例单独给 1）
const eqOnly = (code: string) => (code.startsWith("eq_") ? 1 : 99);

function row(id: number, itemCode: string, slotIndex: number, quantity: number): BagRow {
  return { id, itemCode, slotIndex, quantity };
}

describe("lootInto", () => {
  it("空包新开格从 0 递增", () => {
    const r = lootInto([], [{ itemCode: "yao", qty: 3 }], stackable);
    expect(r.newStacks).toEqual([{ itemCode: "yao", slotIndex: 0, quantity: 3, durabilityMax: null }]);
    expect(r.stackAdds).toEqual([]);
    expect(r.lost).toEqual([]);
  });
  it("先堆后开格：同码未满堆加量，超出部分开新格", () => {
    const r = lootInto([row(1, "yao", 4, 98)], [{ itemCode: "yao", qty: 5 }], stackable);
    expect(r.stackAdds).toEqual([{ id: 1, quantity: 1 }]);
    expect(r.newStacks.map((n) => n.slotIndex)).toEqual([0]);
    expect(r.newStacks[0]!.quantity).toBe(4);
  });
  it("装备不可堆叠（stackMax=1）每件开新格", () => {
    const r = lootInto([], [{ itemCode: "eq_sword", qty: 2 }], eqOnly);
    expect(r.newStacks.map((n) => n.slotIndex)).toEqual([0, 1]);
    expect(r.newStacks.every((n) => n.quantity === 1 && n.durabilityMax !== null)).toBe(true);
  });
  it("包满进 lost（整条丢弃）", () => {
    const full = Array.from({ length: BAG_SLOTS }, (_, i) => row(i + 1, "stone", i, 99));
    const r = lootInto(full, [{ itemCode: "stone", qty: 10 }], stackable);
    expect(r.lost).toEqual([{ itemCode: "stone", qty: 10 }]);
  });
  it("部分入包：能放的进，放不下的整条丢", () => {
    const bag = Array.from({ length: BAG_SLOTS }, (_, i) => row(i + 1, "stone", i, 99));
    const r = lootInto(bag, [{ itemCode: "yao", qty: 5 }], stackable);
    expect(r.lost).toEqual([{ itemCode: "yao", qty: 5 }]);
  });
});

describe("planEquip", () => {
  const mk = (over: Partial<Item> = {}): Item => ({
    code: "eq_x", name: "测试装备", sprite: "/i.png", desc: "", kind: "equipment",
    quality: "green", slot: "main_hand", equipType: "剑", profession: null,
    levelReq: 4, durabilityMax: 10, hands: 1, dmgMin: 5, dmgMax: 7, intervalMs: 2100,
    bonuses: {}, ...over,
  } as Item);
  const char = { level: 5, profession: "warrior" as const };
  const itemByCode = (code: string): Item | undefined => (code === "eq_2h" ? mk({ code: "eq_2h", hands: 2 }) : mk({ code }));

  it("空部位直接穿", () => {
    const p = planEquip(mk(), 11, char, [], itemByCode);
    expect(p).toEqual({ ok: true, targetSlot: "main_hand", unequipInventoryIds: [] });
  });
  it("部位占用直接替换（旧装备回包）", () => {
    const equipped = [{ slotCode: "main_hand" as const, inventoryId: 3, itemCode: "eq_old" }];
    const p = planEquip(mk(), 11, char, equipped, itemByCode);
    expect(p).toEqual({ ok: true, targetSlot: "main_hand", unequipInventoryIds: [3] });
  });
  it("等级不足拒绝", () => {
    const p = planEquip(mk({ levelReq: 6 }), 11, char, [], itemByCode);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toContain("等级");
  });
  it("职业不符拒绝", () => {
    const p = planEquip(mk({ profession: "mage" }), 11, char, [], itemByCode);
    expect(p.ok).toBe(false);
  });
  it("穿双手武器联动卸下副手", () => {
    const equipped = [
      { slotCode: "off_hand" as const, inventoryId: 5, itemCode: "eq_shield" },
    ];
    const p1 = planEquip(mk({ hands: 2, code: "eq_2h" }), 11, char, equipped, itemByCode);
    expect(p1).toEqual({ ok: true, targetSlot: "main_hand", unequipInventoryIds: [5] });
  });
  it("穿副手联动卸下双手主武器", () => {
    const equipped = [{ slotCode: "main_hand" as const, inventoryId: 3, itemCode: "eq_2h" }];
    const p = planEquip(mk({ slot: "off_hand", dmgMin: undefined, dmgMax: undefined, intervalMs: undefined, defBonus: 3, code: "eq_shield" }), 11, char, equipped, itemByCode);
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.unequipInventoryIds).toEqual([3]);
  });
  it("戒指：优先 ring1，再 ring2，都满替换 ring1", () => {
    const ring = mk({ slot: "ring", dmgMin: undefined, dmgMax: undefined, intervalMs: undefined, code: "eq_ring" });
    const p0 = planEquip(ring, 11, char, [], itemByCode);
    expect(p0.ok && p0.targetSlot).toBe("ring1");
    const one = [{ slotCode: "ring1" as const, inventoryId: 6, itemCode: "eq_ring" }];
    expect(planEquip(ring, 11, char, one, itemByCode).ok && (planEquip(ring, 11, char, one, itemByCode) as { targetSlot: string }).targetSlot).toBe("ring2");
    const two = [...one, { slotCode: "ring2" as const, inventoryId: 7, itemCode: "eq_ring" }];
    const p2 = planEquip(ring, 11, char, two, itemByCode);
    expect(p2.ok && p2.targetSlot).toBe("ring1");
    expect(p2.ok && p2.unequipInventoryIds).toEqual([6]);
  });
  it("非装备物品拒绝", () => {
    const p = planEquip({ code: "yao", name: "药", sprite: "/i.png", desc: "", kind: "consumable", effect: { hp: 1 }, stackMax: 99 }, 11, char, [], itemByCode);
    expect(p.ok).toBe(false);
  });
});

describe("firstFreeSlot", () => {
  it("返回最小空闲格；满包返回 null", () => {
    expect(firstFreeSlot([row(1, "a", 0, 1), row(2, "a", 2, 1)])).toBe(1);
    const full = Array.from({ length: BAG_SLOTS }, (_, i) => row(i + 1, "s", i, 1));
    expect(firstFreeSlot(full)).toBeNull();
  });
});

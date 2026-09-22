import { expect, it } from "vitest";
import { equipmentBonusesOf, type EquippedRow } from "../../../src/game/equipment.ts";
import type { Item } from "../../../src/data/schemas.ts";

const mk = (over: Partial<Item> = {}): Item => ({
  code: "eq_x", name: "装备", sprite: "/i.png", desc: "", kind: "equipment",
  quality: "green", slot: "chest", equipType: "皮甲", profession: null,
  levelReq: 1, durabilityMax: 10, hands: 1, defBonus: 2, bonuses: { hp: 10, str: 1 },
  ...over,
} as Item);

const byCode = (code: string): Item | undefined => {
  if (code === "eq_sword") return mk({ code, slot: "main_hand", dmgMin: 7, dmgMax: 9, intervalMs: 2100 }); // 保留底座 defBonus/bonuses（用例断言两件各 def 2/hp 10/str 1）
  if (code === "eq_atk_sword") return mk({ code, slot: "main_hand", dmgMin: 10, dmgMax: 14, intervalMs: 2100, defBonus: undefined, bonuses: { atk: 2 } }); // 能量之卷刃剑型
  if (code === "eq_2h") return mk({ code, slot: "main_hand", hands: 2, dmgMin: 10, dmgMax: 14, intervalMs: 2600, defBonus: undefined, bonuses: {} });
  if (code === "gone") return undefined; // 静态漂移（物品不存在）
  if (code === "not_a_kind") return mk({ code, kind: "material" }); // 静态漂移（非装备 kind）
  return mk({ code });
};

it("汇总防具 def/bonuses 与武器区间攻速", () => {
  const rows: EquippedRow[] = [
    { slotCode: "chest", itemCode: "eq_a", durability: 5 },
    { slotCode: "main_hand", itemCode: "eq_sword", durability: 3 },
  ];
  const b = equipmentBonusesOf(rows, byCode);
  expect(b.def).toBe(4); // 两件各 defBonus 2
  expect(b.hp).toBe(20);
  expect(b.str).toBe(2);
  expect(b.dmgMin).toBe(7);
  expect(b.dmgMax).toBe(9);
  expect(b.intervalMs).toBe(2100);
});

it("atk 词条汇总（蓝宝书「攻击:+N」）", () => {
  const b = equipmentBonusesOf([{ slotCode: "main_hand", itemCode: "eq_atk_sword", durability: 3 }], byCode);
  expect(b.atk).toBe(2);
  expect(b.str).toBe(0); // atk 词条不进五维
});

it("耐久 0 整件失效（武器失效无区间）", () => {
  const b = equipmentBonusesOf([{ slotCode: "main_hand", itemCode: "eq_sword", durability: 0 }], byCode);
  expect(b.dmgMin).toBeNull();
  expect(b.dmgMax).toBeNull();
  expect(b.intervalMs).toBeNull();
  expect(b.def).toBe(0);
});

it("静态漂移行跳过不崩溃", () => {
  const b = equipmentBonusesOf(
    [{ slotCode: "chest", itemCode: "gone", durability: 5 }, { slotCode: "neck", itemCode: "not_a_kind", durability: 5 }],
    byCode,
  );
  expect(b.def).toBe(0);
});

it("空装备全零无武器", () => {
  expect(equipmentBonusesOf([], byCode)).toEqual({
    vit: 0, str: 0, agi: 0, intel: 0, spr: 0, hp: 0, sp: 0, atk: 0, def: 0,
    dmgMin: null, dmgMax: null, intervalMs: null,
  });
});

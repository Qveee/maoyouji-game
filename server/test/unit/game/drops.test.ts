import { expect, it } from "vitest";
import { createRng } from "../../../src/game/rng.ts";
import { rollDrops } from "../../../src/game/drops.ts";

const DROPS = {
  copper: [5, 15] as [number, number],
  items: [
    { item: "a_material", chance: 1.0, qtyMin: 1, qtyMax: 2 },
    { item: "never", chance: 0.0000001, qtyMin: 1, qtyMax: 1 },
    { item: "b_sword", chance: 1.0, qtyMin: 1, qtyMax: 1 },
  ],
};

it("同种子结果完全一致", () => {
  expect(rollDrops(DROPS, createRng(42))).toEqual(rollDrops(DROPS, createRng(42)));
});

it("chance=1 全命中且 copper 在区间内", () => {
  const r = rollDrops(DROPS, createRng(7));
  expect(r.copper).toBeGreaterThanOrEqual(5);
  expect(r.copper).toBeLessThanOrEqual(15);
  expect(r.items.map((i) => i.itemCode)).toEqual(["a_material", "b_sword"]);
  expect(r.items[0]!.qty).toBeGreaterThanOrEqual(1);
  expect(r.items[0]!.qty).toBeLessThanOrEqual(2);
  expect(r.items[1]!.qty).toBe(1);
});

it("全 miss 时 items 为空但 copper 仍入账", () => {
  const r = rollDrops({ copper: [3, 3], items: [{ item: "x", chance: 0.0000001, qtyMin: 1, qtyMax: 1 }] }, createRng(1));
  expect(r.copper).toBe(3);
  expect(r.items).toEqual([]);
});

it("空掉落表返回零铜币", () => {
  expect(rollDrops({ copper: [0, 0], items: [] }, createRng(9))).toEqual({ copper: 0, items: [] });
});

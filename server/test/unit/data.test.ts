import { describe, expect, it } from "vitest";
import { loadMaps, loadPets } from "../../src/data/loader.ts";
import { PetsFileSchema } from "../../src/data/schemas.ts";

describe("静态宠物数据", () => {
  it("内置 pets.json 含 17 种宠物且全部可选", () => {
    const file = loadPets();
    expect(file.pets).toHaveLength(17);
  });

  it("code 重复被拒绝", () => {
    const file = loadPets();
    const dup = { pets: [file.pets[0]!, { ...file.pets[1]!, code: file.pets[0]!.code }] };
    expect(() => PetsFileSchema.parse(dup)).toThrow(/重复/);
  });

  it("初始五维总和不为 25 被拒绝", () => {
    const file = loadPets();
    const bad = { pets: [{ ...file.pets[0]!, baseStats: { vit: 9, str: 9, agi: 5, intel: 5, spr: 5 } }] };
    expect(() => PetsFileSchema.parse(bad)).toThrow(/25/);
  });

  it("猫隐村地图含 20 节点且出生点与锁点合法", () => {
    const village = loadMaps().maps.find((m) => m.code === "maoyin_village")!;
    expect(village.nodes).toHaveLength(20);
    expect(new Set(village.nodes.map((n) => n.code)).size).toBe(20);
    expect(village.spawnNodeCode).toBe("guangchang");
    expect(village.nodes.filter((n) => n.locked)).toHaveLength(1);
    expect(village.nodes.reduce((s, n) => s + n.npcs.length, 0)).toBeGreaterThan(80);
  });
});

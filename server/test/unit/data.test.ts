import { describe, expect, it } from "vitest";
import { loadPets } from "../../src/data/loader.js";
import { PetsFileSchema } from "../../src/data/schemas.js";

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
});

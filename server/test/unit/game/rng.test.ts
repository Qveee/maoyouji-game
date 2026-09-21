import { describe, expect, it } from "vitest";
import { createRng } from "../../../src/game/rng.ts";

describe("mulberry32 随机数发生器", () => {
  it("同种子两次创建，next() 序列逐值相同", () => {
    const r1 = createRng(42);
    const r2 = createRng(42);
    for (let i = 0; i < 20; i++) {
      expect(r2.next()).toBe(r1.next());
    }
  });

  it("不同种子产生不同序列", () => {
    const r1 = createRng(1);
    const r2 = createRng(2);
    const s1 = Array.from({ length: 20 }, () => r1.next());
    const s2 = Array.from({ length: 20 }, () => r2.next());
    expect(s1).not.toEqual(s2);
  });

  it("next() 恒落在 [0,1)", () => {
    const r = createRng(123);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("int(1,3) 大样本全部落在 [1,3] 且三个值都出现", () => {
    const r = createRng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = r.int(1, 3);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(3);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([1, 2, 3]));
  });

  it("状态续跑：从快照恢复的 RNG 精确续写同一序列", () => {
    const r1 = createRng(7);
    r1.next(); // 先消耗一次，保证快照不是初始态
    const saved = r1.state;
    const x1 = r1.next();
    const x2 = r1.next();
    const r2 = createRng(saved);
    expect(r2.next()).toBe(x1);
    expect(r2.next()).toBe(x2);
  });

  it("初始 state 等于 seed 的无符号 32 位值", () => {
    expect(createRng(7).state).toBe(7);
    expect(createRng(-1).state).toBe(4294967295); // -1 >>> 0
  });
});

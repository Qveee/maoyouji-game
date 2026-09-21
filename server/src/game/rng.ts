/**
 * 战斗用固定种子随机数发生器（mulberry32）。
 *
 * 战斗结算要求「同种子同输入 → 同结果」的可复现性，且战斗状态以 JSON 快照
 * 持久化（battles 表），因此 RNG 必须能导出/恢复内部状态，实现精确续跑。
 */
export interface Rng {
  /** 返回 [0,1) 内的均匀浮点数 */
  next(): number;
  /** 返回 [min,max] 双端闭区间内的均匀整数 */
  int(min: number, max: number): number;
  /** 当前 32 位内部状态（含初始 seed>>>0）；createRng(state) 可精确续跑 */
  readonly state: number;
}

/** mulberry32：实现极小、统计性质满足战斗掷点需求的 32 位 PRNG */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const rng: Rng = {
    next: () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int: (min, max) => min + Math.floor(rng.next() * (max - min + 1)),
    get state(): number {
      return a;
    },
  };
  return rng;
}

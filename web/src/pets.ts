import type { Pet } from "./api";

/**
 * 宠物静态数据的展示工具（App / 选角页共用）。
 * 放独立模块而非 api.ts：api.ts 只承载接口契约（类型 + 请求函数），展示层工具不混入。
 */

/** 宠物精灵图 → 静态资源路径：sprite 形如 宠物/朝右/猫.gif，取末段 encode 后拼到 /pets/ 下 */
export function petGifOf(pet?: Pet): string {
  const sprite = pet?.sprite ?? "宠物/朝右/猫.gif";
  return `/pets/${encodeURIComponent(sprite.split("/").pop() ?? "")}`;
}

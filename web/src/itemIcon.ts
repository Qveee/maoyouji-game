import type { BagItemView } from "./api";

/**
 * 图标兜底常量表（InventoryPanel 与 PetPanel 共用）：素材缺失期（web/public/items 尚未入库）
 * 按 kind/equipType 显示的像素 SVG，风格照抄原型 assets/游戏主界面.html 的 crispEdges 像素画
 * （32×32 viewBox，几块 rect 拼剪影）。真图入库后 img 正常加载，兜底自动不再出现。
 */
const FB = "shape-rendering=\"crispEdges\"";
export const FALLBACK_ICONS = {
  // 消耗品：小药瓶（液体红两色 + 玻璃高光）
  potion: `<svg viewBox="0 0 32 32" ${FB}><rect x="14" y="3" width="4" height="4" fill="#8a5a2a"/><rect x="13" y="7" width="6" height="3" fill="#b8c2cc"/><rect x="9" y="10" width="14" height="4" fill="#d8e0e6"/><rect x="8" y="14" width="16" height="12" fill="#c8d4dc"/><rect x="9" y="17" width="14" height="8" fill="#e84a3a"/><rect x="9" y="17" width="4" height="8" fill="#ff7a5a"/><rect x="10" y="12" width="3" height="2" fill="#f4f8fa"/></svg>`,
  // 材料：矿石碎块（蓝/青晶面）
  ore: `<svg viewBox="0 0 32 32" ${FB}><rect x="12" y="5" width="8" height="4" fill="#8a95a0"/><rect x="8" y="9" width="16" height="8" fill="#98a2ae"/><rect x="6" y="13" width="20" height="11" fill="#7a8490"/><rect x="10" y="11" width="5" height="4" fill="#3aa0e8"/><rect x="18" y="15" width="4" height="4" fill="#59d8d0"/><rect x="9" y="24" width="14" height="3" fill="#5a626e"/></svg>`,
  // 主手·剑：斜置剑身 + 护手 + 柄尾金饰
  sword: `<svg viewBox="0 0 32 32" ${FB}><rect x="24" y="3" width="4" height="4" fill="#eef4f8"/><rect x="21" y="6" width="4" height="4" fill="#d8e0e6"/><rect x="18" y="9" width="4" height="4" fill="#c2ced8"/><rect x="15" y="12" width="4" height="4" fill="#aebac6"/><rect x="11" y="16" width="9" height="4" fill="#8a5a2a"/><rect x="8" y="20" width="4" height="4" fill="#6e4a1e"/><rect x="5" y="24" width="4" height="4" fill="#f5c93a"/></svg>`,
  // 主手·魔杖：杖杆 + 顶端紫宝珠
  wand: `<svg viewBox="0 0 32 32" ${FB}><rect x="20" y="3" width="7" height="7" fill="#8a2be2"/><rect x="21" y="2" width="2" height="2" fill="#c9a0f0"/><rect x="18" y="10" width="4" height="4" fill="#8a5a2a"/><rect x="15" y="13" width="4" height="4" fill="#7a4a1e"/><rect x="12" y="16" width="4" height="4" fill="#6e4a1e"/><rect x="9" y="19" width="4" height="4" fill="#5f3f18"/><rect x="6" y="22" width="4" height="4" fill="#8a5a2a"/></svg>`,
  // 主手·枪：长杆 + 刃头
  spear: `<svg viewBox="0 0 32 32" ${FB}><rect x="14" y="2" width="4" height="3" fill="#eef4f8"/><rect x="12" y="5" width="8" height="6" fill="#c2ced8"/><rect x="14" y="11" width="4" height="3" fill="#8a5a2a"/><rect x="14" y="14" width="4" height="15" fill="#a0742e"/></svg>`,
  // 主手·匕首：短刃
  dagger: `<svg viewBox="0 0 32 32" ${FB}><rect x="14" y="5" width="4" height="4" fill="#eef4f8"/><rect x="14" y="9" width="4" height="7" fill="#c2ced8"/><rect x="11" y="16" width="10" height="3" fill="#8a5a2a"/><rect x="14" y="19" width="4" height="8" fill="#6e4a1e"/></svg>`,
  // 主手·爪：三道爪痕
  claw: `<svg viewBox="0 0 32 32" ${FB}><g fill="#c8d4dc"><rect x="6" y="4" width="3" height="11"/><rect x="7" y="15" width="2" height="3"/><rect x="15" y="7" width="3" height="11"/><rect x="16" y="18" width="2" height="3"/><rect x="24" y="4" width="3" height="11"/><rect x="25" y="15" width="2" height="3"/></g></svg>`,
  // 副手·盾牌：盾形 + 金色纹章
  shield: `<svg viewBox="0 0 32 32" ${FB}><rect x="8" y="4" width="16" height="4" fill="#b8c2cc"/><rect x="6" y="8" width="20" height="9" fill="#98a2ae"/><rect x="8" y="17" width="16" height="4" fill="#8a95a0"/><rect x="11" y="21" width="10" height="3" fill="#7a8490"/><rect x="14" y="24" width="4" height="3" fill="#6a7480"/><rect x="14" y="9" width="4" height="2" fill="#f5c93a"/><rect x="12" y="11" width="8" height="2" fill="#f5c93a"/><rect x="14" y="13" width="4" height="2" fill="#f5c93a"/></svg>`,
  // 副手·法典：书形 + 饰字
  tome: `<svg viewBox="0 0 32 32" ${FB}><rect x="6" y="6" width="20" height="20" fill="#8a4a2a"/><rect x="6" y="6" width="4" height="20" fill="#6e381e"/><rect x="10" y="8" width="14" height="16" fill="#a05a34"/><rect x="24" y="7" width="2" height="18" fill="#e8dcc0"/><rect x="14" y="12" width="8" height="2" fill="#f5c93a"/><rect x="17" y="9" width="2" height="9" fill="#f5c93a"/></svg>`,
  head: `<svg viewBox="0 0 32 32" ${FB}><rect x="12" y="5" width="8" height="4" fill="#6a8aaa"/><rect x="9" y="9" width="14" height="11" fill="#5a7a9a"/><rect x="5" y="20" width="22" height="4" fill="#4a6a8a"/><rect x="11" y="11" width="3" height="7" fill="#7a9aba"/></svg>`,
  shoulder: `<svg viewBox="0 0 32 32" ${FB}><rect x="5" y="9" width="22" height="3" fill="#b8c2cc"/><rect x="5" y="12" width="22" height="6" fill="#8a95a0"/><rect x="7" y="18" width="18" height="4" fill="#98a2ae"/><rect x="7" y="22" width="5" height="4" fill="#7a8490"/><rect x="20" y="22" width="5" height="4" fill="#7a8490"/></svg>`,
  chest: `<svg viewBox="0 0 32 32" ${FB}><rect x="8" y="5" width="16" height="5" fill="#8a95a0"/><rect x="6" y="10" width="20" height="13" fill="#98a2ae"/><rect x="8" y="23" width="16" height="4" fill="#7a8490"/><rect x="15" y="10" width="2" height="17" fill="#7a8490"/><rect x="8" y="11" width="3" height="7" fill="#b8c2cc"/></svg>`,
  hands: `<svg viewBox="0 0 32 32" ${FB}><rect x="9" y="5" width="14" height="4" fill="#b87a44"/><rect x="9" y="9" width="14" height="9" fill="#a06a34"/><rect x="6" y="10" width="3" height="7" fill="#a06a34"/><rect x="10" y="18" width="12" height="5" fill="#6e4620"/><rect x="10" y="23" width="12" height="2" fill="#5a3a18"/></svg>`,
  waist: `<svg viewBox="0 0 32 32" ${FB}><rect x="4" y="12" width="24" height="7" fill="#6e4a1e"/><rect x="4" y="12" width="24" height="2" fill="#8a5f2a"/><rect x="12" y="10" width="8" height="11" fill="#f5c93a"/><rect x="14" y="13" width="4" height="5" fill="#a87a10"/></svg>`,
  legs: `<svg viewBox="0 0 32 32" ${FB}><rect x="7" y="4" width="8" height="3" fill="#b8c2cc"/><rect x="17" y="4" width="8" height="3" fill="#b8c2cc"/><rect x="7" y="7" width="8" height="18" fill="#8a95a0"/><rect x="17" y="7" width="8" height="18" fill="#8a95a0"/><rect x="8" y="12" width="6" height="4" fill="#6a7480"/><rect x="18" y="12" width="6" height="4" fill="#6a7480"/><rect x="7" y="25" width="8" height="3" fill="#7a8490"/><rect x="17" y="25" width="8" height="3" fill="#7a8490"/></svg>`,
  feet: `<svg viewBox="0 0 32 32" ${FB}><rect x="10" y="4" width="9" height="14" fill="#6e4a1e"/><rect x="11" y="5" width="3" height="11" fill="#8a5f2a"/><rect x="6" y="18" width="17" height="6" fill="#5a3a18"/><rect x="6" y="23" width="17" height="2" fill="#4a2e12"/></svg>`,
  wrist: `<svg viewBox="0 0 32 32" ${FB}><rect x="10" y="6" width="12" height="17" fill="#8a95a0"/><rect x="10" y="6" width="12" height="3" fill="#b8c2cc"/><rect x="10" y="13" width="12" height="2" fill="#6a7480"/><rect x="10" y="18" width="12" height="2" fill="#6a7480"/></svg>`,
  ring: `<svg viewBox="0 0 32 32" ${FB}><rect x="11" y="14" width="10" height="2" fill="#f5c93a"/><rect x="9" y="16" width="4" height="4" fill="#e0b020"/><rect x="19" y="16" width="4" height="4" fill="#e0b020"/><rect x="11" y="20" width="10" height="2" fill="#d9a41a"/><rect x="14" y="8" width="4" height="5" fill="#3aa0e8"/><rect x="15" y="7" width="2" height="2" fill="#8fd8ff"/></svg>`,
  neck: `<svg viewBox="0 0 32 32" ${FB}><g fill="#c8ccd4"><rect x="6" y="4" width="3" height="3"/><rect x="23" y="4" width="3" height="3"/><rect x="9" y="7" width="3" height="3"/><rect x="20" y="7" width="3" height="3"/><rect x="12" y="10" width="3" height="2"/><rect x="17" y="10" width="3" height="2"/><rect x="15" y="11" width="2" height="2"/></g><rect x="12" y="13" width="8" height="11" fill="#3a6a9a"/><rect x="13" y="14" width="6" height="9" fill="#5a9ad4"/><rect x="14" y="15" width="3" height="3" fill="#8fd8ff"/></svg>`,
  cloak: `<svg viewBox="0 0 32 32" ${FB}><rect x="12" y="3" width="8" height="4" fill="#4a2e5a"/><rect x="8" y="7" width="16" height="9" fill="#6a4a7a"/><rect x="6" y="16" width="20" height="10" fill="#5a3a6a"/><rect x="10" y="10" width="3" height="9" fill="#7a5a8a"/><rect x="9" y="26" width="3" height="2" fill="#3e2549"/><rect x="20" y="26" width="3" height="2" fill="#3e2549"/></svg>`,
} as const;

/** 按物品类型解析兜底图标：消耗品→药瓶、材料→矿石；装备按部位，主手再按 equipType 细分 */
export function fallbackIconOf(item: BagItemView): string {
  if (item.kind === "consumable") return FALLBACK_ICONS.potion;
  if (item.kind === "material") return FALLBACK_ICONS.ore;
  const e = item.equip;
  if (!e) return FALLBACK_ICONS.ore; // 静态漂移兜底行接矿石
  if (e.slot === "main_hand") {
    const t = e.equipType;
    if (t.includes("杖")) return FALLBACK_ICONS.wand;
    if (t.includes("枪")) return FALLBACK_ICONS.spear;
    if (t.includes("匕")) return FALLBACK_ICONS.dagger;
    if (t.includes("爪")) return FALLBACK_ICONS.claw;
    return FALLBACK_ICONS.sword; // 剑与未知武器兜底
  }
  if (e.slot === "off_hand") return e.equipType.includes("典") ? FALLBACK_ICONS.tome : FALLBACK_ICONS.shield;
  const bySlot: Record<string, string> = {
    head: FALLBACK_ICONS.head, shoulder: FALLBACK_ICONS.shoulder, chest: FALLBACK_ICONS.chest,
    hands: FALLBACK_ICONS.hands, waist: FALLBACK_ICONS.waist, legs: FALLBACK_ICONS.legs,
    feet: FALLBACK_ICONS.feet, wrist: FALLBACK_ICONS.wrist, ring: FALLBACK_ICONS.ring,
    neck: FALLBACK_ICONS.neck, cloak: FALLBACK_ICONS.cloak,
  };
  return bySlot[e.slot] ?? FALLBACK_ICONS.ore;
}

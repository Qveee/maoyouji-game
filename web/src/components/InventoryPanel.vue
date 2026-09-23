<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { api, ApiError, type BagItemView, type EquipSlotCode, type InventoryView } from "../api";
import { QUALITY_COLORS, QUALITY_NAMES } from "../quality";

const emit = defineEmits<{ close: []; toast: [string]; changed: []; sys: [string] }>();

const BAG_MAX = 300; // 原版口径 300 格（与 server BAG_SLOTS 一致）

/** 运行时装备栏位展示顺序与中文名（照 server EQUIP_SLOT_CODES 顺序；ring 静态位拆 ring1/ring2） */
const SLOT_ORDER: EquipSlotCode[] = [
  "main_hand", "off_hand", "head", "shoulder", "chest", "hands", "waist",
  "legs", "feet", "wrist", "ring1", "ring2", "neck", "cloak",
];
const SLOT_LABELS: Record<EquipSlotCode, string> = {
  main_hand: "主手", off_hand: "副手", head: "头部", shoulder: "肩部", chest: "胸部",
  hands: "手部", waist: "腰部", legs: "腿部", feet: "足部", wrist: "手腕",
  ring1: "戒指Ⅰ", ring2: "戒指Ⅱ", neck: "项链", cloak: "披风",
};
/** 静态部位中文名（equip.slot 是静态 code，ring 未拆分；详情窗信息行用） */
const PART_LABELS: Record<string, string> = {
  main_hand: "主手", off_hand: "副手", head: "头部", shoulder: "肩部", chest: "胸部",
  hands: "手部", waist: "腰部", legs: "腿部", feet: "足部", wrist: "手腕",
  ring: "戒指", neck: "项链", cloak: "披风",
};
/** 属性加成词条中文（详情窗属性卡用；口径照 docs/游戏规则设计.md 五维：力量/敏捷/体力/智力/精神） */
const STAT_LABELS: Record<string, string> = {
  vit: "体力", str: "力量", agi: "敏捷", intel: "智力", spr: "精神",
  atk: "攻击", hp: "HP", sp: "SP",
};

/**
 * 图标兜底常量表：素材缺失期（web/public/items 尚未入库）按 kind/equipType 显示的
 * 像素 SVG，风格照抄原型 assets/游戏主界面.html 的 crispEdges 像素画（32×32 viewBox，
 * 几块 rect 拼剪影）。真图入库后 img 正常加载，兜底自动不再出现。
 */
const FB = "shape-rendering=\"crispEdges\"";
const FALLBACK_ICONS = {
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
function fallbackIconOf(item: BagItemView): string {
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

const view = ref<InventoryView | null>(null);
const winEl = ref<HTMLElement | null>(null);
const listEl = ref<HTMLElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);

const minimized = ref(false); // 最小化：只留标题条
const showEquipped = ref(false); // 【已装备】链接：列表切换为已穿装备行

// ---------- 派生视图 ----------
const bagLen = computed(() => view.value?.bag.length ?? 0);
const capPct = computed(() => ((bagLen.value / BAG_MAX) * 100).toFixed(1) + "%");
/** 服务端只有 copper 总数：1金=10000铜、1银=100铜，三段全显示（0 也显示，照原型） */
const money = computed(() => {
  const c = view.value?.copper ?? 0;
  return { gold: Math.floor(c / 10000), silver: Math.floor((c % 10000) / 100), copper: c % 100 };
});

/** 列表行统一形状：背包行与已穿装备行共用 .bag-row 视觉；qt 背包=数量、已穿=部位名 */
interface ListRow {
  key: string;
  item: BagItemView;
  qt: string;
  slotCode: EquipSlotCode | null; // 已穿行携带，卸下用
}

const rows = computed<ListRow[]>(() => {
  if (showEquipped.value) {
    const eq = view.value?.equipment;
    if (!eq) return [];
    return SLOT_ORDER.filter((s) => eq[s] != null).map((s) => ({
      key: `eq:${s}`,
      item: eq[s]!,
      qt: SLOT_LABELS[s],
      slotCode: s,
    }));
  }
  return (view.value?.bag ?? []).map((it) => ({
    key: `bag:${it.inventoryId}`,
    item: it,
    qt: `${it.quantity} 个`,
    slotCode: null,
  }));
});

/** 名字品质着色：装备用原型调色板品质色，非装备回退默认正文色 */
function nmColor(item: BagItemView): string | undefined {
  return item.quality ? QUALITY_COLORS[item.quality] : undefined;
}

/** 精灵图缺文件（public/items 素材尚未入库）时记入破图集：列表与详情位切换到像素 SVG 兜底 */
const brokenSprites = ref<ReadonlySet<string>>(new Set());
function onImgErr(item: BagItemView): void {
  brokenSprites.value = new Set(brokenSprites.value).add(item.itemCode);
}

// ---------- 数据加载与统一操作出口 ----------
async function reload(): Promise<boolean> {
  try {
    view.value = await api.inventory();
    return true;
  } catch (err) {
    emit("toast", err instanceof ApiError ? err.message : "背包加载失败");
    return false;
  }
}
onMounted(() => {
  reload();
  loadLevel();
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onGlobalKey);
});
onUnmounted(() => {
  document.removeEventListener("click", onDocClick);
  document.removeEventListener("keydown", onGlobalKey);
});

/** 统一操作出口：成功重拉视图，ApiError.message / 兜底文案经 toast 上报 */
async function act(run: () => Promise<unknown>, fallback: string): Promise<boolean> {
  try {
    await run();
    await reload();
    return true;
  } catch (err) {
    emit("toast", err instanceof ApiError ? err.message : fallback);
    return false;
  }
}

async function onRefresh() {
  if (await reload()) emit("toast", "背包已刷新喵~ (=^･ω･^=)");
}

/** 【已装备】链接：背包列表 ↔ 已穿装备列表切换（切换时收起行菜单） */
function toggleEquipped() {
  showEquipped.value = !showEquipped.value;
  closeBagActions();
}

// ---------- 列表行点击 → active 高亮 + 菜单紧贴鼠标右侧弹出 ----------
const activeKey = ref<string | null>(null);
const menu = ref<{ row: ListRow; x: number; y: number } | null>(null);

function closeBagActions() {
  activeKey.value = null;
  menu.value = null;
}

async function onRowClick(row: ListRow, e: MouseEvent) {
  const wasActive = activeKey.value === row.key;
  closeBagActions();
  if (wasActive) return;
  activeKey.value = row.key;
  menu.value = { row, x: 0, y: 0 };
  await nextTick(); // 等菜单渲染出真实尺寸再定位
  const m = menuEl.value;
  if (!m || !menu.value) return; // 等待期间被 document 点击关闭的空档
  // 照原型：紧贴鼠标右侧弹出，边缘自动翻转
  let x = e.clientX + 6;
  let y = e.clientY - 12;
  if (x + m.offsetWidth > window.innerWidth - 8) x = e.clientX - m.offsetWidth - 6;
  if (y + m.offsetHeight > window.innerHeight - 8) y = e.clientY - m.offsetHeight;
  if (y < 8) y = 8;
  menu.value = { ...menu.value, x, y };
}

/** 点空白关闭（照原型：不在列表也不在菜单内的点击都收起） */
function onDocClick(e: MouseEvent) {
  if (!menu.value) return;
  const t = e.target as Node;
  if (listEl.value?.contains(t) || menuEl.value?.contains(t)) return;
  closeBagActions();
}

/** 菜单按钮组成按 kind 与所在列表：背包装备=[说明,穿戴,转让,丢弃,秀]、消耗品=[说明,使用,转让,丢弃,秀]、
 *  材料=[说明,转让,丢弃,秀]；已穿装备行=[说明,卸下] */
const menuButtons = computed(() => {
  const row = menu.value?.row;
  if (!row) return [];
  const acts: { act: string; label: string }[] = [{ act: "desc", label: "说明" }];
  if (row.slotCode != null) {
    acts.push({ act: "unequip", label: "卸下" });
    return acts;
  }
  if (row.item.kind === "equipment") acts.push({ act: "equip", label: "穿戴" });
  if (row.item.kind === "consumable") acts.push({ act: "use", label: "使用" });
  acts.push({ act: "transfer", label: "转让" }, { act: "discard", label: "丢弃" }, { act: "show", label: "秀" });
  return acts;
});

async function onMenuAction(actName: string) {
  const row = menu.value?.row;
  closeBagActions();
  if (!row) return;
  if (actName === "desc") {
    detail.value = row; // 详情窗独立常开，直到点它自己的关闭
  } else if (actName === "equip") {
    if (await act(() => api.equip(row.item.inventoryId), "穿戴失败")) emit("changed");
  } else if (actName === "use") {
    // 用药成功会改 hp/sp：除重拉背包外，再让 GameShell 刷新角色面板
    if (await act(() => api.useItem(row.item.inventoryId), "使用失败")) emit("changed");
  } else if (actName === "unequip") {
    if (row.slotCode && (await act(() => api.unequip(row.slotCode!), "卸下失败"))) emit("changed");
  } else if (actName === "discard") {
    // 不立即删：弹二次确认小框（每次丢 1），确认后才真正调用
    await openDiscardConfirm(row);
  } else if (actName === "transfer") {
    emit("toast", `转让【${row.item.name}】（功能预留）`);
  } else if (actName === "show") {
    emit("toast", `秀【${row.item.name}】（功能预留）`);
  }
}

// ---------- 道具说明窗（照原型 #item-detail-win；装备类升级为完整属性卡） ----------
const detail = ref<ListRow | null>(null);

// ---------- 丢弃二次确认（防误删；仅丢弃走确认，穿戴/使用/卸下不变） ----------
const discardTarget = ref<ListRow | null>(null);
const confirmEl = ref<HTMLElement | null>(null);
const confirmPos = ref({ x: 0, y: 0 });

/** 打开确认框：居中于游戏区（Teleport 到 body 后用 .shell 的屏幕矩形换算视口坐标） */
async function openDiscardConfirm(row: ListRow) {
  discardTarget.value = row; // 行菜单已在 onMenuAction 开头收起
  await nextTick(); // 等小框渲染出真实尺寸
  const el = confirmEl.value;
  const shell = winEl.value?.offsetParent as HTMLElement | null;
  if (!el || !shell) return;
  const g = shell.getBoundingClientRect(); // 缩放后的屏幕矩形，与 body 下 fixed 坐标系一致
  confirmPos.value = {
    x: Math.max(0, g.left + (g.width - el.offsetWidth) / 2),
    y: Math.max(0, g.top + (g.height - el.offsetHeight) / 2),
  };
}

/** 确认丢弃：真正调用 api.discard（每次 1 个），成功重拉 + toast */
async function onDiscardConfirm() {
  const row = discardTarget.value;
  discardTarget.value = null;
  if (!row) return;
  if (await act(() => api.discard(row.item.inventoryId, 1), "丢弃失败")) {
    // 丢弃成功不走浮层 toast：落左下角聊天记录区系统行（与掉落明细行一致）
    emit("sys", `${row.item.name}×1 丢弃成功！`);
  }
}

/** Esc 关闭确认框（常驻监听，未开框时为空操作） */
function onGlobalKey(e: KeyboardEvent) {
  if (e.key === "Escape") discardTarget.value = null;
}

/** 角色等级（等级需求未达标标红用）：无 props 合同变更，经 me()+characters() 自取，失败仅不标红 */
const charLevel = ref<number | null>(null);
async function loadLevel() {
  try {
    const me = await api.me();
    if (!me.characterId) return;
    const { characters } = await api.characters();
    charLevel.value = characters.find((c) => c.id === me.characterId)?.level ?? null;
  } catch {
    /* 等级仅用于标红，获取失败静默降级 */
  }
}

/** 装备属性卡逐行内容（样式与原型描述文字一致；color 为品质色/未达标红） */
const detailEquipLines = computed<{ text: string; color?: string }[]>(() => {
  const it = detail.value?.item;
  if (!it || it.kind !== "equipment" || !it.equip) return [];
  const e = it.equip;
  const lines: { text: string; color?: string }[] = [];
  if (it.quality) {
    lines.push({ text: `品质：${QUALITY_NAMES[it.quality] ?? it.quality}`, color: QUALITY_COLORS[it.quality] });
  }
  lines.push({ text: `部位：${PART_LABELS[e.slot] ?? e.slot}·${e.equipType}` });
  const lvText = `等级需求：${e.levelReq}`;
  lines.push(
    charLevel.value != null && charLevel.value < e.levelReq
      ? { text: lvText, color: "#c33812" } // 原型页签红：等级不足标红
      : { text: lvText },
  );
  if (it.durability != null) {
    lines.push({ text: `耐久：${it.durability}/${e.durabilityMax}${it.durability === 0 ? "（失效）" : ""}` });
  }
  if (e.dmgMin != null && e.dmgMax != null) {
    lines.push({ text: `伤害：${e.dmgMin}~${e.dmgMax}` });
    if (e.intervalMs != null) {
      lines.push({ text: `攻速：${(e.intervalMs / 1000).toFixed(1).replace(/\.0$/, "")} 秒` });
    }
  }
  if (e.defBonus != null) {
    lines.push({ text: `防御：+${e.defBonus}` });
  }
  for (const [k, v] of Object.entries(e.bonuses)) {
    if (v) lines.push({ text: `${STAT_LABELS[k] ?? k}：+${v}` });
  }
  return lines;
});

// ---------- 背包窗口拖动（照原型：标题条按下，限制在游戏窗口内） ----------
const winPos = ref({ x: 712, y: 76 }); // 原型 #bag-win 初始坐标（相对 1400×832 游戏窗口）
let drag: { dx: number; dy: number } | null = null;

function onDragStart(e: MouseEvent) {
  if ((e.target as HTMLElement).closest(".win-btn")) return;
  const win = winEl.value;
  const shell = win?.offsetParent as HTMLElement | null; // 定位基准 = GameShell .shell（1400×832）
  if (!win || !shell) return;
  const scale = shell.getBoundingClientRect().width / shell.offsetWidth || 1; // stage-fit 缩放系数
  const rect = win.getBoundingClientRect();
  drag = { dx: (e.clientX - rect.left) / scale, dy: (e.clientY - rect.top) / scale };
  e.preventDefault();
  document.addEventListener("mousemove", onDragMove);
  document.addEventListener("mouseup", onDragEnd);
}
function onDragMove(e: MouseEvent) {
  const win = winEl.value;
  const shell = win?.offsetParent as HTMLElement | null;
  if (!drag || !win || !shell) return;
  const g = shell.getBoundingClientRect();
  const scale = g.width / shell.offsetWidth || 1;
  // 屏幕坐标 → 布局坐标（除以缩放系数），再夹紧在游戏窗口内
  let x = (e.clientX - g.left) / scale - drag.dx;
  let y = (e.clientY - g.top) / scale - drag.dy;
  x = Math.max(0, Math.min(shell.offsetWidth - win.offsetWidth, x));
  y = Math.max(0, Math.min(shell.offsetHeight - win.offsetHeight, y));
  winPos.value = { x, y };
}
function onDragEnd() {
  drag = null;
  document.removeEventListener("mousemove", onDragMove);
  document.removeEventListener("mouseup", onDragEnd);
}
</script>

<template>
  <!-- 背包窗口（照原型 #bag-win：355×430 毛玻璃圆角，标题/副栏/容量条/列表） -->
  <div
    ref="winEl"
    class="bag-win"
    :class="{ min: minimized }"
    :style="{ left: winPos.x + 'px', top: winPos.y + 'px' }"
    role="dialog"
    aria-label="道具背包"
  >
    <div class="bag-title" @mousedown="onDragStart">
      <b>携带道具: {{ bagLen }} / {{ BAG_MAX }}</b>
      <div class="win-btns">
        <button type="button" class="win-btn" title="刷新背包" @click="onRefresh">
          <svg viewBox="0 0 12 12"><g fill="currentColor"><path d="M1 2.5h6v-2l4 3-4 3v-2H1z"/><path d="M11 9.5H5v2l-4-3 4-3v2h6z"/></g></svg>
        </button>
        <button type="button" class="win-btn" title="最小化" @click="minimized = !minimized">
          <svg viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" fill="currentColor"/></svg>
        </button>
        <button type="button" class="win-btn" title="关闭" @click="emit('close')">
          <svg viewBox="0 0 12 12"><g stroke="currentColor" stroke-width="2" stroke-linecap="square"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></g></svg>
        </button>
      </div>
    </div>

    <div class="bag-sub">
      <a title="前往货币兑换" @click.prevent="emit('toast', '【兑换猫眼】功能建设中,敬请期待喵~')">【兑换猫眼】</a>
      <a title="查看已穿戴的装备" @click.prevent="toggleEquipped">【已装备】</a>
      <div class="bag-money">
        <span class="coin" title="金币"><svg viewBox="0 0 13 13"><circle cx="6.5" cy="6.5" r="5.5" fill="#f5c93a" stroke="#a87a10" stroke-width="1"/><rect x="4.5" y="4.5" width="4" height="4" fill="#a87a10"/></svg>{{ money.gold }}</span>
        <span class="coin" title="银币"><svg viewBox="0 0 13 13"><circle cx="6.5" cy="6.5" r="5.5" fill="#c8ccd4" stroke="#8a8f99" stroke-width="1"/><rect x="4.5" y="4.5" width="4" height="4" fill="#8a8f99"/></svg>{{ money.silver }}</span>
        <span class="coin" title="铜币"><svg viewBox="0 0 13 13"><circle cx="6.5" cy="6.5" r="5.5" fill="#d98a50" stroke="#9a5a24" stroke-width="1"/><rect x="4.5" y="4.5" width="4" height="4" fill="#9a5a24"/></svg>{{ money.copper }}</span>
      </div>
    </div>

    <div class="bag-capbar"><i :style="{ width: capPct }"></i><span>{{ bagLen }} / {{ BAG_MAX }}</span></div>

    <div ref="listEl" class="bag-list">
      <div
        v-for="row in rows"
        :key="row.key"
        class="bag-row"
        :class="{ active: row.key === activeKey }"
        @click="onRowClick(row, $event)"
      >
        <span class="ic" :title="row.item.desc">
          <img
            v-if="row.item.sprite && !brokenSprites.has(row.item.itemCode)"
            :src="row.item.sprite"
            :alt="row.item.name"
            @error="onImgErr(row.item)"
          />
          <span v-else class="ic-fallback" aria-hidden="true" v-html="fallbackIconOf(row.item)"></span>
        </span>
        <a class="nm" :title="row.item.desc" :style="{ color: nmColor(row.item) }">{{ row.item.name }}</a>
        <span class="qt">{{ row.qt }}</span>
      </div>
    </div>
  </div>

  <!-- 道具操作菜单（照原型 #bag-menu：fixed 紧贴鼠标，Teleport 到 body 避开 stage-fit 缩放劫持） -->
  <Teleport to="body">
    <div v-if="menu" ref="menuEl" class="bag-menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }">
      <button v-for="b in menuButtons" :key="b.act" type="button" @click="onMenuAction(b.act)">{{ b.label }}</button>
    </div>
  </Teleport>

  <!-- 丢弃二次确认小框：窗体语言照 item-detail-win，按钮规格照 #bag-menu；
       Teleport 到 body 避开 stage-fit 缩放劫持，居中坐标按 .shell 屏幕矩形换算 -->
  <Teleport to="body">
    <div v-if="discardTarget" class="discard-mask" @click="discardTarget = null">
      <div
        ref="confirmEl"
        class="discard-win"
        :style="{ left: confirmPos.x + 'px', top: confirmPos.y + 'px' }"
        role="alertdialog"
        aria-label="丢弃确认"
        @click.stop
      >
        <div class="item-head">
          <b>丢弃确认</b>
          <div class="win-btns">
            <button type="button" class="win-btn" title="关闭" @click="discardTarget = null">
              <svg viewBox="0 0 12 12"><g stroke="currentColor" stroke-width="2" stroke-linecap="square"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></g></svg>
            </button>
          </div>
        </div>
        <div class="discard-body">
          <p>确认丢弃【{{ discardTarget.item.name }}】×1？</p>
          <div class="discard-btns">
            <button type="button" @click="onDiscardConfirm">确认</button>
            <button type="button" @click="discardTarget = null">取消</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 道具说明窗（照原型 #item-detail-win：与背包窗同为游戏窗口的绝对定位兄弟节点） -->
  <div v-if="detail" class="item-detail-win">
    <div class="item-head">
      <b>道具说明</b>
      <div class="win-btns">
        <button type="button" class="win-btn" title="关闭" @click="detail = null">
          <svg viewBox="0 0 12 12"><g stroke="currentColor" stroke-width="2" stroke-linecap="square"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></g></svg>
        </button>
      </div>
    </div>
    <div class="item-body">
      <span class="item-figure">
        <img
          v-if="detail.item.sprite && !brokenSprites.has(detail.item.itemCode)"
          :src="detail.item.sprite"
          :alt="detail.item.name"
          @error="onImgErr(detail.item)"
        />
        <span v-else class="ic-fallback lg" aria-hidden="true" v-html="fallbackIconOf(detail.item)"></span>
      </span>
      <div class="item-info">
        <b>{{ detail.item.name }}</b>
        <p>{{ detail.item.desc || "（暂无描述。）" }}</p>
        <p
          v-for="(l, i) in detailEquipLines"
          :key="i"
          :style="l.color ? { color: l.color } : undefined"
        >{{ l.text }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ============ 背包窗口（CSS 照抄原型 #bag-win 段） ============ */
.bag-win {
  position: absolute;
  z-index: 40;
  width: 355px;
  height: 430px;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(14px);
  box-shadow: 0 8px 32px rgba(31, 38, 135, 0.28);
  font-family: "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
  overflow: hidden;
}
.bag-win.min { height: auto; }
.bag-win.min .bag-sub,
.bag-win.min .bag-capbar,
.bag-win.min .bag-list { display: none; }
.bag-title {
  height: auto;
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 14px 4px;
  cursor: move;
  user-select: none;
}
.bag-title b { font: 600 14px "Microsoft YaHei", sans-serif; color: #1e293b; letter-spacing: 0.3px; }
.win-btns { margin-left: auto; display: flex; gap: 2px; }
.win-btn {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  padding: 0;
  background: rgba(255, 255, 255, 0.5);
  color: #334155;
  display: grid;
  place-items: center;
}
.win-btn:hover { background: rgba(255, 255, 255, 0.9); }
.win-btn svg { width: 11px; height: 11px; display: block; }
.bag-sub { height: auto; flex: none; display: flex; align-items: center; gap: 6px; padding: 2px 14px 8px; }
.bag-sub a { font: 500 13px "Microsoft YaHei", sans-serif; color: #4f46e5; text-decoration: none; cursor: pointer; }
.bag-sub a:hover { text-decoration: underline; }
.bag-money {
  margin-left: auto;
  display: flex;
  gap: 10px;
  align-items: center;
  font: 600 13px "Segoe UI", sans-serif;
  color: #334155;
}
.bag-money .coin { display: flex; align-items: center; gap: 3px; }
.bag-money svg { width: 13px; height: 13px; display: block; }
.bag-capbar {
  flex: none;
  height: 16px;
  margin: 0 14px 8px;
  position: relative;
  background: rgba(255, 255, 255, 0.55);
  border-radius: 99px;
}
.bag-capbar i {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 99px;
  background: linear-gradient(90deg, #4f46e5, #818cf8);
  transition: width 0.3s;
}
.bag-capbar span {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  font: 700 10px Verdana;
  color: #1e293b;
}
.bag-list {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.9) transparent;
}
.bag-list::-webkit-scrollbar { width: 8px; }
.bag-list::-webkit-scrollbar-track { background: transparent; }
.bag-list::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.9); border-radius: 99px; }
.bag-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 46px;
  padding: 0 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.55);
  transition: background 0.15s;
  cursor: pointer;
}
.bag-row:nth-child(odd) { background: rgba(255, 255, 255, 0.22); }
.bag-row:nth-child(even) { background: rgba(255, 255, 255, 0.4); }
.bag-row:hover { background: rgba(255, 255, 255, 0.7); }
.bag-row .ic {
  width: 32px;
  height: 32px;
  flex: none;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.6);
  overflow: hidden;
}
.bag-row .ic img { width: 28px; height: 28px; object-fit: contain; display: block; image-rendering: pixelated; }
/* 兜底像素 SVG（v-html 注入内容无 scoped 标记，需 :deep 穿透）；尺寸对齐真图位 */
.ic-fallback { display: block; width: 28px; height: 28px; }
.ic-fallback :deep(svg) { width: 28px; height: 28px; display: block; }
.bag-row .nm {
  font: 500 13px "Microsoft YaHei", sans-serif;
  color: #1e293b;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bag-row .nm:hover { text-decoration: underline; }
.bag-row .qt {
  margin-left: auto;
  font: 700 13px "Segoe UI", sans-serif;
  color: #4f46e5;
  background: rgba(79, 70, 229, 0.14);
  padding: 2px 10px;
  border-radius: 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex: none;
}
.bag-row.active { background: rgba(255, 255, 255, 0.82); box-shadow: inset 3px 0 0 #4f46e5; }

/* ============ 道具操作菜单（CSS 照抄原型 #bag-menu 段） ============ */
.bag-menu {
  position: fixed;
  z-index: 95;
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #94a3b8;
  box-shadow: 0 3px 10px rgba(15, 23, 42, 0.25);
}
.bag-menu button {
  height: 22px;
  padding: 0 8px;
  cursor: pointer;
  color: #1e293b;
  font: 12px SimSun, "宋体", serif;
  background: linear-gradient(#fff, #e2e8f0);
  border: 1px solid #94a3b8;
  border-radius: 3px;
  box-shadow: inset 0 1px 0 #fff;
}
.bag-menu button:hover { background: linear-gradient(#fff, #f8fafc); border-color: #4f46e5; color: #3730a3; }
.bag-menu button:active { box-shadow: inset 0 2px 3px rgba(15, 23, 42, 0.2); }

/* ============ 丢弃二次确认小框（窗体语言照 #item-detail-win，遮罩盖全屏） ============ */
.discard-mask { position: fixed; inset: 0; z-index: 100; background: rgba(15, 23, 42, 0.35); }
.discard-win {
  position: absolute;
  width: 240px;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(14px);
  box-shadow: 0 8px 28px rgba(31, 38, 135, 0.3);
  font-family: "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
  overflow: hidden;
}
.discard-body { padding: 14px 16px 12px; }
.discard-body p { font: 13px/1.7 "Microsoft YaHei", sans-serif; color: #1e293b; margin: 0 0 12px; }
.discard-btns { display: flex; gap: 8px; justify-content: flex-end; }
/* 按钮照 #bag-menu button 同款规格 */
.discard-btns button {
  height: 24px;
  padding: 0 12px;
  cursor: pointer;
  color: #1e293b;
  font: 12px SimSun, "宋体", serif;
  background: linear-gradient(#fff, #e2e8f0);
  border: 1px solid #94a3b8;
  border-radius: 3px;
  box-shadow: inset 0 1px 0 #fff;
}
.discard-btns button:hover { background: linear-gradient(#fff, #f8fafc); border-color: #4f46e5; color: #3730a3; }
.discard-btns button:active { box-shadow: inset 0 2px 3px rgba(15, 23, 42, 0.2); }

/* ============ 道具说明窗（CSS 照抄原型 #item-detail-win 段） ============ */
.item-detail-win {
  position: absolute;
  left: 410px;
  top: 126px;
  z-index: 55;
  width: 270px;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(14px);
  box-shadow: 0 8px 28px rgba(31, 38, 135, 0.3);
  font-family: "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
  overflow: hidden;
}
.item-head {
  height: 34px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px 0 12px;
  background: rgba(255, 255, 255, 0.45);
  border-bottom: 1px solid rgba(255, 255, 255, 0.7);
  user-select: none;
}
.item-head b { font: 600 13px "Microsoft YaHei", sans-serif; color: #1e293b; }
.item-body { display: flex; gap: 12px; padding: 12px 14px 14px; }
.item-figure {
  width: 64px;
  height: 64px;
  flex: none;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid rgba(148, 163, 184, 0.55);
  border-radius: 8px;
  overflow: hidden;
}
.item-figure img { width: 52px; height: 52px; object-fit: contain; display: block; image-rendering: pixelated; }
.item-figure .ic-fallback,
.item-figure .ic-fallback :deep(svg) { width: 52px; height: 52px; }
.item-info { min-width: 0; flex: 1; }
.item-info b { display: block; font: 600 14px/1.4 "Microsoft YaHei", sans-serif; color: #1e293b; margin-bottom: 5px; }
.item-info p { font: 12px/1.7 "Microsoft YaHei", sans-serif; color: #334155; white-space: pre-wrap; }
</style>

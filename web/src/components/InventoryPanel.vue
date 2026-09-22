<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { api, ApiError, type BagItemView, type EquipSlotCode, type InventoryView } from "../api";
import { QUALITY_COLORS, QUALITY_NAMES } from "../quality";

const emit = defineEmits<{ close: []; toast: [string]; changed: [] }>();

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

/** 精灵图缺文件（public/items 素材尚未入库）时隐藏破图，只留图标底框 */
function onImgErr(e: Event): void {
  (e.target as HTMLElement).style.visibility = "hidden";
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
});
onUnmounted(() => document.removeEventListener("click", onDocClick));

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
    // 不弹数量输入，每次丢 1
    if (await act(() => api.discard(row.item.inventoryId, 1), "丢弃失败")) {
      emit("toast", `丢弃了 ${row.item.name}×1`);
    }
  } else if (actName === "transfer") {
    emit("toast", `转让【${row.item.name}】（功能预留）`);
  } else if (actName === "show") {
    emit("toast", `秀【${row.item.name}】（功能预留）`);
  }
}

// ---------- 道具说明窗（照原型 #item-detail-win；装备类升级为完整属性卡） ----------
const detail = ref<ListRow | null>(null);

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
          <img v-if="row.item.sprite" :src="row.item.sprite" :alt="row.item.name" @error="onImgErr" />
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
        <img v-if="detail.item.sprite" :src="detail.item.sprite" :alt="detail.item.name" @error="onImgErr" />
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
.item-info { min-width: 0; flex: 1; }
.item-info b { display: block; font: 600 14px/1.4 "Microsoft YaHei", sans-serif; color: #1e293b; margin-bottom: 5px; }
.item-info p { font: 12px/1.7 "Microsoft YaHei", sans-serif; color: #334155; white-space: pre-wrap; }
</style>

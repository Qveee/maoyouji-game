<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { api, ApiError, type BagItemView, type EquipSlotCode, type InventoryView } from "../api";
import { QUALITY_COLORS } from "../quality";
import { fallbackIconOf } from "../itemIcon";
import ItemDetailWindow from "./ItemDetailWindow.vue";

const emit = defineEmits<{
  close: [];
  toast: [string];
  changed: [];
  sys: [string];
  /** 「装备后绑定」装备的第一击被服务端拦下：上报给 GameShell 在左下聊天区插确认行（含待穿行与名字） */
  bindConfirm: [info: { inventoryId: number; name: string }];
}>();

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
    qt: `${it.quantity} ${it.unit ?? "个"}`,
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

/** 外部刷新入口（GameShell 在聊天区确认绑定后经 ref 调用）：重拉背包视图 */
async function refresh(): Promise<boolean> {
  return reload();
}
defineExpose({ refresh });

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
    detail.value = row.item; // 详情窗独立常开，直到点它自己的关闭
  } else if (actName === "equip") {
    // 两段式确认第一击：「装备后绑定」装备被服务端拦下 → 上报 GameShell 在聊天区插确认行；
    // 直接成功（已绑定装备/确认后的行为 GameShell 处理）走既有刷新+通知，不额外弹 toast
    try {
      const res = await api.equip(row.item.inventoryId);
      if ("needBindConfirm" in res && res.needBindConfirm) {
        emit("bindConfirm", { inventoryId: row.item.inventoryId, name: res.name });
        emit("toast", "请在左下角确认绑定");
      } else {
        await reload();
        emit("changed");
      }
    } catch (err) {
      emit("toast", err instanceof ApiError ? err.message : "穿戴失败");
    }
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

// ---------- 道具说明窗（共享 ItemDetailWindow 组件，宠物窗装备名点击同用；显隐由下方 v-if 控制） ----------
const detail = ref<BagItemView | null>(null);

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

  <!-- 道具说明窗（共享 ItemDetailWindow 组件：照原型 #item-detail-win，与背包窗同为游戏窗口的绝对定位兄弟节点） -->
  <ItemDetailWindow v-if="detail" :item="detail" @close="detail = null" />
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

/* ============ 道具说明窗样式随共享组件 ItemDetailWindow.vue（.item-head/.win-btns/.win-btn
   仍留在本文件：丢弃确认小框复用同一窗体语言，照原型 #item-detail-win 段） ============ */
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
</style>

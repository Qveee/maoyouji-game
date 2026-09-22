<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, ApiError, type BagItemView, type EquipSlotCode, type InventoryView } from "../api";
import { QUALITY_COLORS, QUALITY_NAMES } from "../quality";

const emit = defineEmits<{ close: []; toast: [string]; changed: [] }>();

/** 装备栏位展示顺序与中文名（照 server EQUIP_SLOT_CODES 顺序；ring 静态位拆 ring1/ring2） */
const SLOT_ORDER: EquipSlotCode[] = [
  "main_hand", "off_hand", "head", "shoulder", "chest", "hands", "waist",
  "legs", "feet", "wrist", "ring1", "ring2", "neck", "cloak",
];
const SLOT_LABELS: Record<EquipSlotCode, string> = {
  main_hand: "主手", off_hand: "副手", head: "头部", shoulder: "肩部", chest: "胸部",
  hands: "手部", waist: "腰部", legs: "腿部", feet: "足部", wrist: "手腕",
  ring1: "戒指Ⅰ", ring2: "戒指Ⅱ", neck: "项链", cloak: "披风",
};
const BAG_SLOTS = 300; // 原版口径 300 格（与 server BAG_SLOTS 一致）

const view = ref<InventoryView | null>(null);
const winEl = ref<HTMLElement | null>(null);

/** 品质色：非装备（quality=""）与未知品质回退正文深蓝 */
function qColor(quality: string): string {
  return QUALITY_COLORS[quality] ?? "#14506e";
}

/** 已穿件悬浮提示：无品质（静态漂移兜底行）时不带品质段 */
function equipTitle(item: BagItemView): string {
  const q = QUALITY_NAMES[item.quality];
  return q ? `${item.name}（${q}，点击脱下）` : `${item.name}（点击脱下）`;
}

/** 铜币换算：1金=10000铜、1银=100铜，零段不显示（不足进位显示），全零显示「0铜」 */
function fmtCopper(c: number): string {
  if (c <= 0) return "0铜";
  const gold = Math.floor(c / 10000);
  const silver = Math.floor((c % 10000) / 100);
  const copper = c % 100;
  const parts: string[] = [];
  if (gold) parts.push(`${gold}金`);
  if (silver) parts.push(`${silver}银`);
  if (copper) parts.push(`${copper}铜`);
  return parts.join("") || "0铜";
}

/** 左侧 14 装备栏位（含已穿件投影，空位 null） */
const equipCells = computed(() =>
  SLOT_ORDER.map((slotCode) => ({ slotCode, item: view.value?.equipment[slotCode] ?? null })),
);

/** 右侧 300 格：按 slotIndex 落位（服务端已按 slotIndex 升序，未占格 null） */
const bagCells = computed<(BagItemView | null)[]>(() => {
  const cells: (BagItemView | null)[] = Array<BagItemView | null>(BAG_SLOTS).fill(null);
  for (const it of view.value?.bag ?? []) {
    if (it.slotIndex != null && it.slotIndex >= 0 && it.slotIndex < BAG_SLOTS) cells[it.slotIndex] = it;
  }
  return cells;
});

/** 统一操作出口：成功重拉视图，ApiError.message / 兜底文案经 toast 上报 */
async function act(run: () => Promise<unknown>, fallback: string): Promise<boolean> {
  try {
    await run();
    view.value = await api.inventory();
    return true;
  } catch (err) {
    emit("toast", err instanceof ApiError ? err.message : fallback);
    return false;
  }
}

async function reload() {
  try {
    view.value = await api.inventory();
  } catch (err) {
    emit("toast", err instanceof ApiError ? err.message : "背包加载失败");
  }
}
onMounted(reload);

// ---------- 小操作条（点背包格弹出，点遮罩关闭） ----------
const sel = ref<{ item: BagItemView; x: number; y: number } | null>(null);

/** 定位在点击格旁（坐标相对窗口，右/下溢出内收夹紧；stage-fit 缩放下按缩放系数还原布局坐标） */
function openActions(item: BagItemView, e: MouseEvent) {
  const el = winEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const scale = rect.width / el.offsetWidth || 1; // 屏幕/布局宽 = 缩放系数（照 GameShell doLunge 口径）
  const x = (e.clientX - rect.left) / scale;
  const y = (e.clientY - rect.top) / scale;
  const BAR_W = 224; // 操作条最大估宽（名字 108 + 双按钮），夹紧防右溢出
  const BAR_H = 30;
  sel.value = {
    item,
    x: Math.max(6, Math.min(x - 4, el.clientWidth - BAR_W - 6)),
    y: Math.max(6, Math.min(y + 6, el.clientHeight - BAR_H - 6)),
  };
}

async function unequipSlot(slotCode: EquipSlotCode) {
  await act(() => api.unequip(slotCode), "脱下失败");
}

async function doEquip(item: BagItemView) {
  sel.value = null;
  await act(() => api.equip(item.inventoryId), "穿戴失败");
}

async function doUse(item: BagItemView) {
  sel.value = null;
  // 用药成功会改 hp/sp：除重拉背包外，再让 GameShell 刷新角色面板
  if (await act(() => api.useItem(item.inventoryId), "使用失败")) emit("changed");
}

async function doDiscard(item: BagItemView) {
  sel.value = null;
  await act(() => api.discard(item.inventoryId), "丢弃失败"); // quantity 缺省=整堆丢弃
}
</script>

<template>
  <div ref="winEl" class="inv-win" role="dialog" aria-label="道具背包">
    <!-- 操作条打开时的遮罩：点任意处关闭 -->
    <div v-if="sel" class="mask" @click="sel = null"></div>

    <div class="titlebar">
      <span class="tt">道具背包</span>
      <button type="button" class="close" title="关闭" @click="emit('close')">✕</button>
    </div>

    <div class="copper">铜币：<b>{{ fmtCopper(view?.copper ?? 0) }}</b></div>

    <div class="content">
      <!-- 左：14 装备栏位（4 列网格），已穿=名字缩写+品质色边框，点击=脱下 -->
      <div class="equip">
        <div
          v-for="c in equipCells"
          :key="c.slotCode"
          class="eslot"
          :class="{ filled: !!c.item, broken: c.item?.durability === 0 }"
          :style="c.item ? { borderColor: qColor(c.item.quality) } : undefined"
          :title="c.item ? equipTitle(c.item) : SLOT_LABELS[c.slotCode]"
          @click="c.item && unequipSlot(c.slotCode)"
        >
          <span v-if="c.item" class="ename" :style="{ color: qColor(c.item.quality) }">{{ c.item.name.slice(0, 2) }}</span>
          <span v-else class="elabel">{{ SLOT_LABELS[c.slotCode] }}</span>
        </div>
      </div>

      <!-- 右：300 格背包（10 列滚动），品质色名字 + 数量角标 -->
      <div class="bagwrap">
        <div class="grid scr">
          <div
            v-for="(it, i) in bagCells"
            :key="i"
            class="cell"
            :class="{ filled: !!it }"
            :title="it ? `${it.name}×${it.quantity}` : undefined"
            @click="it && openActions(it, $event)"
          >
            <template v-if="it">
              <span class="iname" :style="{ color: qColor(it.quality) }">{{ it.name.slice(0, 1) }}</span>
              <i v-if="it.quantity > 1" class="qty">{{ it.quantity }}</i>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- 小操作条：装备→穿戴、消耗品→使用、全部→丢弃 -->
    <div v-if="sel" class="actbar" :style="{ left: sel.x + 'px', top: sel.y + 'px' }">
      <span class="aname" :style="{ color: qColor(sel.item.quality) }">{{ sel.item.name }}</span>
      <button v-if="sel.item.kind === 'equipment'" type="button" @click="doEquip(sel.item)">穿戴</button>
      <button v-if="sel.item.kind === 'consumable'" type="button" @click="doUse(sel.item)">使用</button>
      <button type="button" @click="doDiscard(sel.item)">丢弃</button>
    </div>
  </div>
</template>

<style scoped>
/* 复刻原版道具窗口：620×420、浅蓝渐变、深蓝正文、宋体 12px、Windows 立体边框 */
.inv-win {
  position: absolute;
  z-index: 50;
  left: 50%;
  top: 50%;
  width: 620px;
  height: 420px;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  background: linear-gradient(#cde9f5, #aed7ea);
  border: 1px solid #14506e;
  box-shadow:
    inset 1px 1px 0 #eaf7fd,
    inset -1px -1px 0 #7fa8bd,
    0 6px 18px rgba(8, 40, 60, 0.4);
  font: 12px/1.6 "SimSun", "宋体", serif;
  color: #14506e;
}
.mask {
  position: absolute;
  inset: 0;
  z-index: 5;
}
.titlebar {
  flex: none;
  height: 24px;
  display: flex;
  align-items: center;
  padding: 0 4px 0 8px;
  font-weight: 700;
  background: linear-gradient(#d9f0fa, #b7dcee);
  border-bottom: 1px solid #58b1d8;
  box-shadow: inset 0 1px 0 #f2fbff;
}
.titlebar .tt { flex: 1; }
.titlebar .close {
  width: 18px;
  height: 18px;
  padding: 0;
  cursor: pointer;
  font: bold 11px/16px Tahoma, SimSun, sans-serif;
  color: #333;
  background: linear-gradient(#fdfefe, #d4e2ea);
  border: 1px solid #6f9fb8;
  box-shadow: inset 1px 1px 0 #fff;
}
.titlebar .close:hover { color: #c33812; border-color: #c33812; }
.copper {
  flex: none;
  padding: 3px 10px 1px;
}
.copper b { color: #8a5a00; }
.content {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 6px;
  padding: 4px 10px 10px;
}

/* 左：装备栏 4 列网格 */
.equip {
  flex: none;
  width: 186px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  align-content: start;
}
.eslot {
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.45);
  border: 1px solid #7fb3cc;
  box-shadow: inset 1px 1px 0 rgba(255, 255, 255, 0.7);
  cursor: default;
  overflow: hidden;
}
.eslot.filled { cursor: pointer; background: rgba(255, 255, 255, 0.75); }
.eslot.filled:hover { background: #fffdf0; }
.eslot.broken { filter: grayscale(1); opacity: 0.65; }
.eslot .elabel { color: #6c93a6; }
.eslot .ename {
  font-weight: 700;
  white-space: nowrap;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.8);
}

/* 右：背包 10 列 300 格滚动 */
.bagwrap {
  flex: 1;
  min-width: 0;
  background: rgba(255, 255, 255, 0.28);
  border: 1px solid #7fb3cc;
  box-shadow: inset 1px 1px 2px rgba(40, 80, 100, 0.25);
  overflow: hidden;
}
.grid {
  height: 100%;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 2px;
  padding: 3px;
  align-content: start;
}
.grid::-webkit-scrollbar { width: 8px; }
.grid::-webkit-scrollbar-thumb { background: #8db8cd; border-radius: 4px; }
.cell {
  position: relative;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.4);
  border: 1px solid #7fb3cc;
}
.cell.filled { cursor: pointer; background: rgba(255, 255, 255, 0.72); }
.cell.filled:hover { background: #fffdf0; border-color: #3a8ec2; }
.cell .iname {
  font-weight: 700;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.8);
}
.cell .qty {
  position: absolute;
  right: 1px;
  bottom: 0;
  font: bold 10px/12px Tahoma, Verdana, sans-serif;
  font-style: normal;
  color: #fff;
  text-shadow: 0 1px 1px #000;
}

/* 小操作条 */
.actbar {
  position: absolute;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 400px;
  padding: 3px 6px;
  background: linear-gradient(#fdfefe, #dceaf2);
  border: 1px solid #14506e;
  box-shadow: inset 1px 1px 0 #fff, 0 2px 6px rgba(10, 40, 60, 0.35);
  white-space: nowrap;
}
.actbar .aname {
  max-width: 108px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 700;
}
.actbar button {
  height: 20px;
  padding: 0 6px;
  cursor: pointer;
  font: 12px/18px "SimSun", "宋体", serif;
  color: #14506e;
  background: linear-gradient(#fdfefe, #d4e2ea);
  border: 1px solid #6f9fb8;
  box-shadow: inset 1px 1px 0 #fff;
}
.actbar button:hover { background: linear-gradient(#fffdf0, #cfe3ee); border-color: #3a8ec2; }
</style>

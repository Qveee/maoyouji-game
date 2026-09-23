<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, ApiError, type BagItemView, type Character, type EquipSlotCode, type InventoryView } from "../api";
import { QUALITY_COLORS } from "../quality";
import { fallbackIconOf } from "../itemIcon";

/** 角色属性由 GameShell 传入（当前角色 reactive 状态），穿戴与汇总加成打开窗口时经 api.inventory() 拉取 */
const props = defineProps<{ character: Character }>();
const emit = defineEmits<{ close: []; toast: [string]; changed: [] }>();

const minimized = ref(false); // 最小化：只留标题条（.pet-head 本身隐形，视觉上只剩两枚按钮）
const view = ref<InventoryView | null>(null);

const PROFESSION_NAMES: Record<Character["profession"], string> = { warrior: "战士", mage: "法师" };

/** 运行时装备栏位展示顺序（照 server EQUIP_SLOT_CODES；ring 静态位拆 ring1/ring2） */
const SLOT_ORDER: EquipSlotCode[] = [
  "main_hand", "off_hand", "head", "shoulder", "chest", "hands", "waist",
  "legs", "feet", "wrist", "ring1", "ring2", "neck", "cloak",
];
/** 部位中文（宠物窗口径：ring1/ring2 均显示「戒指」，与原型 pislot 风格一致） */
const SLOT_LABELS: Record<EquipSlotCode, string> = {
  main_hand: "主手", off_hand: "副手", head: "头部", shoulder: "肩部", chest: "胸部",
  hands: "手部", waist: "腰部", legs: "腿部", feet: "脚部", wrist: "腕部",
  ring1: "戒指", ring2: "戒指", neck: "项链", cloak: "披风",
};

/** 装备行：equipment 14 键中非 null 的部位（行序照 SLOT_ORDER） */
interface EqRow {
  slot: EquipSlotCode;
  item: BagItemView;
}
const eqRows = computed<EqRow[]>(() => {
  const eq = view.value?.equipment;
  if (!eq) return [];
  return SLOT_ORDER.filter((s) => eq[s] != null).map((s) => ({ slot: s, item: eq[s]! }));
});

// ---------- 头部信息 / 六维属性 ----------
/** 六维：基础值 + 穿戴汇总加成（.add 绿色）；两列排布照原型（力量|敏捷 / 体力|智力 / 精神|空） */
const stats = computed(() => {
  const b = view.value?.bonuses;
  return {
    str: { label: "力量", v: props.character.str + (b?.str ?? 0) },
    agi: { label: "敏捷", v: props.character.agi + (b?.agi ?? 0) },
    vit: { label: "体力", v: props.character.vit + (b?.vit ?? 0) },
    intel: { label: "智力", v: props.character.intel + (b?.intel ?? 0) },
    spr: { label: "精神", v: props.character.spr + (b?.spr ?? 0) },
  };
});

// ---------- 战斗属性 ----------
/** 徒手口径（无武器时服务端的实际战斗数值，与 server/src/game/rules.ts 保持同步：UNARMED_MIN/MAX、PLAYER_ATTACK_MS） */
const UNARMED = {
  min: 1,
  max: 3,
  intervalMs: { warrior: 2000, mage: 2200 } as Record<Character["profession"], number>,
};

/** 伤害区间：有武器显示 dmgMin - dmgMax，无武器按约定显示「徒手」 */
const dmgText = computed(() => {
  const b = view.value?.bonuses;
  if (b?.dmgMin != null && b?.dmgMax != null) return `${b.dmgMin} - ${b.dmgMax}`;
  return "徒手";
});

/** 出手间隔：主手武器攻速，无武器用职业徒手间隔 */
const paceMs = computed(
  () => view.value?.bonuses.intervalMs ?? UNARMED.intervalMs[props.character.profession],
);
/** 秒伤 = 伤害区间均值 ÷ 攻速秒数（一位小数） */
const dpsText = computed(() => {
  const b = view.value?.bonuses;
  const mean =
    b?.dmgMin != null && b?.dmgMax != null ? (b.dmgMin + b.dmgMax) / 2 : (UNARMED.min + UNARMED.max) / 2;
  return (mean / (paceMs.value / 1000)).toFixed(1);
});
/** 攻速：intervalMs/1000（2、2.2、2.6 这样，尾零不显示） */
const speedText = computed(() => String(parseFloat((paceMs.value / 1000).toFixed(2))));
const atkText = computed(() => String(view.value?.bonuses.atk ?? 0));
const defText = computed(() => String(view.value?.bonuses.def ?? 0));

// ---------- 装备行品质与图标 ----------
/** 品质 → 原型品质类（仅 gray/blue/purple 有对应类）；green/orange 原型未定义，回退 QUALITY_COLORS 内联色 */
const Q_CLASS: Record<string, string> = { gray: "q-w", blue: "q-b", purple: "q-p" };
function nmClass(quality: string): string | undefined {
  return Q_CLASS[quality];
}
function nmStyle(quality: string): { color: string } | undefined {
  return Q_CLASS[quality] ? undefined : QUALITY_COLORS[quality] ? { color: QUALITY_COLORS[quality] } : undefined;
}

/** 精灵图缺文件（public/items 素材尚未入库）时记入破图集：该行切换到像素 SVG 兜底（共享 itemIcon 模块） */
const broken = ref<ReadonlySet<string>>(new Set());
function markBroken(item: BagItemView): void {
  broken.value = new Set(broken.value).add(item.itemCode);
}

// ---------- 数据加载与操作 ----------
async function reload(): Promise<boolean> {
  try {
    view.value = await api.inventory();
    return true;
  } catch (err) {
    emit("toast", err instanceof ApiError ? err.message : "宠物窗加载失败");
    return false;
  }
}
onMounted(() => {
  void reload();
});

/** 卸下：成功后重拉穿戴/加成并通知 GameShell 刷新角色面板；失败 message 经 toast 上报 */
async function onUnequip(row: EqRow) {
  try {
    await api.unequip(row.slot);
  } catch (err) {
    emit("toast", err instanceof ApiError ? err.message : "卸下失败");
    return;
  }
  await reload();
  emit("changed");
}

/** 装备名点击（照原型）：仅提示功能预留 */
function onNameClick(item: BagItemView) {
  emit("toast", `${item.name}（装备操作功能预留）`);
}

// ---------- 窗口拖动（照原型：隐形标题条按下拖动，限制在游戏窗口内；写法照 InventoryPanel 适配 stage-fit 缩放） ----------
const winEl = ref<HTMLElement | null>(null);
const winPos = ref({ x: 920, y: 40 }); // 原型 #pet-win 初始坐标（相对 1400×832 游戏窗口）
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
  <!-- 宠物窗（照原型 #pet-win：421×760 浅灰白底，隐形标题条 + 左竖线内容区） -->
  <div
    ref="winEl"
    class="pet-win"
    :class="{ min: minimized }"
    :style="{ left: winPos.x + 'px', top: winPos.y + 'px' }"
    role="dialog"
    aria-label="宠物"
  >
    <div class="pet-head" @mousedown="onDragStart">
      <b>宠物</b>
      <span class="cnt"></span>
      <div class="win-btns">
        <button type="button" class="win-btn" title="最小化" @click="minimized = !minimized">
          <svg viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" fill="currentColor"/></svg>
        </button>
        <button type="button" class="win-btn" title="关闭" @click="emit('close')">
          <svg viewBox="0 0 12 12"><g stroke="currentColor" stroke-width="2" stroke-linecap="square"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></g></svg>
        </button>
      </div>
    </div>
    <div class="pet-body">
      <!-- ① 头部信息（今日运势/战斗力无对应系统，整行省略） -->
      <div>
        <span class="fname">{{ character.name }}</span>
        <svg class="spk" width="27" height="25" viewBox="0 0 27 25"><path d="M6 1.5 H21.5 A3.5 3.5 0 0 1 25 5 V13.5 A3.5 3.5 0 0 1 21.5 17 H12 L5.5 23 V17 H5.5 A3.5 3.5 0 0 1 2 13.5 V5 A3.5 3.5 0 0 1 5.5 1.5 Z" fill="#fff" stroke="#454F63" stroke-width="1.6"/><rect x="6" y="5.5" width="14" height="2" fill="#454F63"/><rect x="6" y="9.5" width="14" height="2" fill="#454F63"/><rect x="6" y="13.5" width="10" height="2" fill="#454F63"/></svg>
        <span class="expline">{{ PROFESSION_NAMES[character.profession] }} <span class="lv">Lv <b>{{ character.level }}</b></span></span>
      </div>
      <hr>
      <!-- ② 六维属性（基础 + 穿戴加成） -->
      <table class="attr"><tbody>
        <tr>
          <td>{{ stats.str.label }}:&thinsp;<span class="add">{{ stats.str.v }}</span></td><td>{{ stats.agi.label }}:&thinsp;<span class="add">{{ stats.agi.v }}</span></td></tr><tr>
          <td>{{ stats.vit.label }}:&thinsp;<span class="add">{{ stats.vit.v }}</span></td><td>{{ stats.intel.label }}:&thinsp;<span class="add">{{ stats.intel.v }}</span></td></tr><tr>
          <td>{{ stats.spr.label }}:&thinsp;<span class="add">{{ stats.spr.v }}</span></td><td></td></tr>
      </tbody></table>
      <hr>
      <!-- ③ 战斗属性（重击/资历/成就无对应系统，整行省略） -->
      <table class="attr"><tbody>
        <tr>
          <td>伤害:&thinsp;<b class="dmg">{{ dmgText }}</b></td><td>秒伤:&thinsp;<span class="dps">{{ dpsText }}</span></td></tr><tr>
          <td>攻击:&thinsp;<span class="atk">{{ atkText }}</span></td><td>防御:&thinsp;<span class="def">{{ defText }}</span></td></tr><tr>
          <td>攻速:&thinsp;{{ speedText }}</td><td></td></tr>
      </tbody></table>
      <hr>
      <!-- ④ 穿戴装备列表（自动修理无对应系统，整行省略；ops 列改为「卸下」文字链接） -->
      <table class="eqs"><tbody>
        <tr v-for="row in eqRows" :key="row.slot">
          <td class="ic">
            <img
              v-if="row.item.sprite && !broken.has(row.item.itemCode)"
              :src="row.item.sprite"
              :alt="row.item.name"
              @error="markBroken(row.item)"
            />
            <span v-else class="ic-fb" aria-hidden="true" v-html="fallbackIconOf(row.item)"></span>
          </td>
          <td class="nm">
            <a :class="nmClass(row.item.quality)" :style="nmStyle(row.item.quality)" @click="onNameClick(row.item)">{{ row.item.name }}</a><span class="pislot">({{ SLOT_LABELS[row.slot] }})</span>
          </td>
          <td class="ops"><a title="卸下到背包" @click="onUnequip(row)">卸下</a></td>
        </tr>
      </tbody></table>
    </div>
  </div>
</template>

<style scoped>
/* ============ 宠物窗（CSS 照抄原型 #pet-win 段；left/top 由拖动绑定接管，初始值 920/40 与原型一致） ============ */
.pet-win {
  position: absolute;
  z-index: 41;
  width: 421px;
  height: 760px;
  display: flex;
  flex-direction: column;
  background: #f2f2f2;
  border: 1px solid #c4c4c4; /* 白色带点灰 */
  box-shadow: 2px 2px 7px rgba(20, 40, 60, 0.35);
  font: 16px/21px SimSun, "宋体", serif;
  color: #000;
}
.pet-win.min { height: auto; }
.pet-win.min .pet-body { display: none; }
/* 隐形拖动条：标题条本身无背景无边框，标题文字也不显示 */
.pet-head {
  height: 20px;
  flex: none;
  display: flex;
  align-items: center;
  padding: 0 4px 0 0;
  background: transparent;
  border-bottom: none;
  cursor: move;
  user-select: none;
}
.pet-head b,
.pet-head .cnt { display: none; }
/* margin-left:auto 来自原型全局 .win-btns 规则，#pet-win 段仅覆盖 display/gap/flex */
.pet-win .win-btns { margin-left: auto; display: flex; gap: 2px; flex: none; }
.pet-win .win-btn {
  width: 19px;
  height: 19px;
  border: 1px solid #8aa8b8;
  border-radius: 0;
  cursor: pointer;
  padding: 0;
  background: linear-gradient(#ffffff, #dcecf5);
  color: #14506e;
  display: grid;
  place-items: center;
}
.pet-win .win-btn:hover { background: linear-gradient(#fffbe8, #ffe9ae); border-color: #d8a94e; }
.pet-win .win-btn svg { width: 11px; height: 11px; display: block; }
/* 左侧竖线，线左为同色留边 */
.pet-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 15px 30px 20px 26px;
  margin-left: 8px;
  border-left: 1px solid #c0c0c0;
}
.pet-body a { cursor: pointer; text-decoration: none; }
.pet-win .fname { font-weight: bold; font-family: Arial; }
.pet-win .lv { font-family: Arial; }
.pet-win .lv b { color: red; }
.pet-win .spk { vertical-align: -12px; margin: 0 10px 0 3px; }
.pet-win .expline { color: #2747a7; }
.pet-win hr { border: none; border-top: 1px solid #c0c0c0; margin: 12px 0 13px; }
.pet-win .attr { border-collapse: collapse; width: 100%; }
.pet-win .attr td { padding: 3px 2px; width: 50%; line-height: 22px; vertical-align: middle; }
.pet-win .add { color: #009900; }
.pet-win .dmg { color: #105e8b; font-weight: bold; }
.pet-win .dps { color: #ff4000; }
.pet-win .atk { color: #f32c77; }
.pet-win .def { color: #217081; }
.pet-win .eqs { border-collapse: separate; border-spacing: 0 6px; width: 100%; margin-top: -4px; }
.pet-win .eqs td { vertical-align: middle; padding: 0; }
.pet-win .eqs .ic { width: 32px; }
.pet-win .eqs .nm { width: 172px; line-height: 22px; }
.pet-win .eqs .nm a { font-weight: bold; }
.pet-win .eqs .ops { text-align: right; padding-right: 15px; white-space: nowrap; }
.pet-win .q-b { color: #0070dd; }
.pet-win .q-p { color: #a335ee; }
.pet-win .q-w { color: #333; }
.pet-win .pislot { color: #000; }
/* 精灵图位（原型为 31×31 内联 SVG 图标；真 sprite 图按同尺寸盒子直出，缺文件回退共享像素 SVG） */
.pet-win .eqs .ic img { display: block; width: 31px; height: 31px; object-fit: contain; image-rendering: pixelated; }
.pet-win .eqs .ic .ic-fb { display: block; width: 31px; height: 31px; }
.pet-win .eqs .ic .ic-fb :deep(svg) { display: block; width: 31px; height: 31px; }
/* ops 列「卸下」文字链接（原型的修理/快捷栏图标无对应系统）：同 .nm a 样式，悬停加下划线提示可点 */
.pet-win .eqs .ops a:hover { text-decoration: underline; }
</style>

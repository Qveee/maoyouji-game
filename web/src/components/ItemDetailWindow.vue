<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api, type BagItemView, type BindState } from "../api";
import { QUALITY_COLORS } from "../quality";
import { fallbackIconOf } from "../itemIcon";

/**
 * 道具说明窗（照原版截图 游戏内截图/装备信息展示.png 逐像素复刻：#EEE 平底 + 1px #777 边框 + 宋体）。
 * 背包窗「说明」菜单与宠物窗装备名单击共用的唯一实现（品质色/属性卡逻辑随组件走，勿在调用方复刻）；
 * 显隐由父级 v-if 控制，关闭经 close 事件上报（父级清空详情数据）。
 */
const props = defineProps<{
  item: BagItemView;
  /** 开启锚点（游戏窗口布局坐标，通常=「说明」点击处鼠标位）：null=走默认初始位（宠物窗入口） */
  origin?: { x: number; y: number } | null;
}>();
const emit = defineEmits<{ close: [] }>();

/** 静态部位中文短名（equip.slot 是静态 code）：照原版口径（静态 desc 用语「头/胸/脚/腿/手套/右手/左手」与截图「脚.」） */
const PART_LABELS: Record<string, string> = {
  main_hand: "右手", off_hand: "左手", head: "头", shoulder: "肩", chest: "胸",
  hands: "手套", waist: "腰", legs: "腿", feet: "脚", wrist: "腕",
  ring: "戒指", neck: "项链", cloak: "披风",
};
/** 属性加成词条中文（口径照 docs/游戏规则设计.md 五维：力量/敏捷/体力/智力/精神） */
const STAT_LABELS: Record<string, string> = {
  vit: "体力", str: "力量", agi: "敏捷", intel: "智力", spr: "精神",
  atk: "攻击", hp: "HP", sp: "SP",
};
/** 属性词条展示顺序（截图口径：体力→智力→精神为其子列；先五维后战斗词条） */
const STAT_ORDER = ["str", "agi", "vit", "intel", "spr", "atk", "hp", "sp"] as const;

/** 绑定状态行文案（bind_state 列两取值；统一灰字仅文字区分，2026-09-23 用户指定；
 *  灰度照截图实测 #999999；bind_on_equip=装备后绑定（可交易地基）、bound=已绑定（不可交易）） */
const BIND_STATE_LABELS: Record<BindState, string> = {
  bind_on_equip: "装备后绑定",
  bound: "已绑定",
};

/** 角色等级（等级需求未达标标红用）：组件自取，失败仅不标红 */
const charLevel = ref<number | null>(null);
onMounted(async () => {
  try {
    const me = await api.me();
    if (!me.characterId) return;
    const { characters } = await api.characters();
    charLevel.value = characters.find((c) => c.id === me.characterId)?.level ?? null;
  } catch {
    /* 等级仅用于标红，获取失败静默降级 */
  }
});

/** 精灵图缺文件（public/items 素材尚未入库）时切换到像素 SVG 兜底（共享 itemIcon 模块） */
const broken = ref(false);

/** ■ 为拖动把手（2026-09-23 用户指正：原版 ■ 代表可拖动，非最小化/隐藏）。
 *  拖动写法照 InventoryPanel/PetPanel：按住 ■ 平移整窗，屏幕坐标经 stage-fit 缩放折算回布局坐标，钳制在游戏窗口内 */
const winEl = ref<HTMLElement | null>(null);
const winPos = ref({ x: 410, y: 126 }); // 默认坐标（相对 1400×832 游戏窗口；带 origin 时被锚点覆盖）
let drag: { dx: number; dy: number } | null = null;

/** 锚到鼠标隔壁（+6px 让指针不压窗角），并钳制在游戏窗口内；窗自身尺寸要挂载后才有 */
function anchorTo(origin: { x: number; y: number }) {
  const win = winEl.value;
  const shell = win?.offsetParent as HTMLElement | null; // 定位基准 = GameShell .shell（1400×832）
  if (!win || !shell) {
    winPos.value = { ...origin };
    return;
  }
  winPos.value = {
    x: Math.max(0, Math.min(origin.x + 6, shell.offsetWidth - win.offsetWidth)),
    y: Math.max(0, Math.min(origin.y + 6, shell.offsetHeight - win.offsetHeight)),
  };
}
onMounted(() => {
  if (props.origin) anchorTo(props.origin);
});
watch(
  () => props.origin,
  (o) => {
    if (o) anchorTo(o); // 窗常开时再点别的「说明」：重新锚到新点击处
  },
);

function onDragStart(e: MouseEvent) {
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

/** 名字品质色（截图实测蓝 #0070dd，经 quality.ts 全局口径）；无品质（消耗品/材料）回落黑字 */
const nameColor = computed(() => QUALITY_COLORS[props.item.quality]);

/** 装备属性卡（照截图行序：绑定 → 部位·类型 → 耐久 → 伤害/攻速 → 防御 → 属性 → 空行 → 等级需求） */
const equipCard = computed(() => {
  const it = props.item;
  if (it.kind !== "equipment" || !it.equip) return null;
  const e = it.equip;
  return {
    bind: BIND_STATE_LABELS[it.bindState],
    slotLabel: `${PART_LABELS[e.slot] ?? e.slot}.`,
    typeName: e.equipType,
    fail: it.durability === 0 ? "（失效）" : "",
    dur: it.durability != null ? `${it.durability}/${e.durabilityMax}` : null,
    dmg: e.dmgMin != null && e.dmgMax != null ? `${e.dmgMin}-${e.dmgMax}` : null,
    speed: e.intervalMs != null ? `${(e.intervalMs / 1000).toFixed(1).replace(/\.0$/, "")} 秒` : null,
    def: e.defBonus,
    /** 属性词条按固定顺序输出（Object 顺序随静态 JSON，不可依赖） */
    stats: STAT_ORDER.filter((k) => e.bonuses[k]).map((k) => ({ label: STAT_LABELS[k] ?? k, value: e.bonuses[k]! })),
    levelReq: e.levelReq,
    unmet: charLevel.value != null && charLevel.value < e.levelReq,
  };
});
</script>

<template>
  <div ref="winEl" class="item-detail-win" :style="{ left: winPos.x + 'px', top: winPos.y + 'px' }" role="dialog" aria-label="道具说明">
    <div class="win-btns">
      <span class="win-drag" title="拖动" @mousedown="onDragStart">
        <svg viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" fill="currentColor"/></svg>
      </span>
      <button type="button" class="win-btn" title="关闭" @click="emit('close')">
        <svg viewBox="0 0 12 12"><g stroke="currentColor" stroke-width="2" stroke-linecap="square"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></g></svg>
      </button>
    </div>
    <div class="item-body">
      <div class="item-top">
        <span class="item-figure">
          <img
            v-if="item.sprite && !broken"
            :src="item.sprite"
            :alt="item.name"
            @error="broken = true"
          />
          <span v-else class="ic-fallback" aria-hidden="true" v-html="fallbackIconOf(item)"></span>
        </span>
        <b class="item-name" :style="nameColor ? { color: nameColor } : undefined">{{ item.name }}</b>
      </div>
      <div v-if="equipCard" class="item-rest">
        <p class="ln gray">{{ equipCard.bind }}</p>
        <p class="ln slot"><span>{{ equipCard.slotLabel }}</span><span>{{ equipCard.typeName }}</span></p>
        <p v-if="equipCard.dur" class="ln">耐久:{{ equipCard.dur }}{{ equipCard.fail }}</p>
        <p v-if="equipCard.dmg" class="ln">伤害:{{ equipCard.dmg }}</p>
        <p v-if="equipCard.speed" class="ln">攻速:{{ equipCard.speed }}</p>
        <p v-if="equipCard.def != null" class="ln">防御:<i class="gv">+{{ equipCard.def }}</i></p>
        <p v-for="s in equipCard.stats" :key="s.label" class="ln">{{ s.label }}:<i class="gv">+{{ s.value }}</i></p>
        <p class="ln req" :class="{ unmet: equipCard.unmet }">装备需要:等级:{{ equipCard.levelReq }}</p>
      </div>
      <div v-else class="item-rest">
        <p v-if="item.desc" class="ln desc">{{ item.desc }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ============ 道具说明窗（照原版截图逐段实测复刻，勿改回毛玻璃风）；
   2026-09-23 用户指定整体放大两档（12→14px / 234→280px），非截图原尺寸 ============ */
.item-detail-win {
  position: absolute;
  z-index: 55;
  width: 280px; /* 含边框；截图原尺寸 234px，放大见上注 */
  border: 1px solid #777777;
  background: #eeeeee;
  box-shadow: 0 0 7px rgba(20, 40, 60, 0.35);
  font: 14px/22px SimSun, "宋体", serif;
  color: #000000;
}
.win-btns {
  position: absolute;
  top: 6px;
  right: 5px;
  z-index: 1;
  display: flex;
  gap: 8px;
}
.win-btn,
.win-drag {
  width: 12px;
  height: 12px;
  padding: 0;
  border: none;
  background: none;
  color: #000000;
  display: grid;
  place-items: center;
}
.win-btn { cursor: pointer; }
.win-drag { cursor: move; user-select: none; } /* ■ 拖动把手 */
.win-btn svg,
.win-drag svg { width: 10px; height: 10px; display: block; }
.item-body { padding: 10px 11px 11px; }
.item-top {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  margin-right: 30px; /* 让出右上 ■/× 按钮 */
}
.item-figure { flex: none; display: grid; place-items: center; }
.item-figure img { width: 26px; height: 26px; object-fit: contain; display: block; image-rendering: pixelated; }
.item-figure .ic-fallback { display: block; width: 26px; height: 26px; }
.item-figure .ic-fallback :deep(svg) { display: block; width: 26px; height: 26px; }
.item-name { font: bold 14px/22px SimSun, "宋体", serif; } /* 品质名加粗（截图笔画粗于正文） */
.item-rest { margin-top: 6px; }
.item-body p { margin: 0; }
.ln.gray { color: #999999; }
.ln.slot { display: flex; justify-content: space-between; }
.ln.req { margin-top: 18px; } /* 空一行（截图口径） */
.ln.req.unmet { color: #c33812; } /* 等级不足整行标红（原版页签红） */
.gv { font-style: normal; color: #008000; } /* 属性数值绿：截图实测 #008000 */
.ln.desc { white-space: pre-wrap; }
</style>

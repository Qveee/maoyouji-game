<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, type BagItemView, type BindState } from "../api";
import { QUALITY_COLORS, QUALITY_NAMES } from "../quality";
import { fallbackIconOf } from "../itemIcon";

/**
 * 道具说明窗（照原型 #item-detail-win，含装备完整属性卡）。
 * 背包窗「说明」菜单与宠物窗装备名单击共用的唯一实现（品质色/属性卡逻辑随组件走，勿在调用方复刻）；
 * 显隐由父级 v-if 控制，关闭经 close 事件上报（父级清空详情数据）。
 */
const props = defineProps<{ item: BagItemView }>();
const emit = defineEmits<{ close: [] }>();

/** 静态部位中文名（equip.slot 是静态 code，ring 未拆分；信息行用） */
const PART_LABELS: Record<string, string> = {
  main_hand: "主手", off_hand: "副手", head: "头部", shoulder: "肩部", chest: "胸部",
  hands: "手部", waist: "腰部", legs: "腿部", feet: "足部", wrist: "手腕",
  ring: "戒指", neck: "项链", cloak: "披风",
};
/** 属性加成词条中文（属性卡用；口径照 docs/游戏规则设计.md 五维：力量/敏捷/体力/智力/精神） */
const STAT_LABELS: Record<string, string> = {
  vit: "体力", str: "力量", agi: "敏捷", intel: "智力", spr: "精神",
  atk: "攻击", hp: "HP", sp: "SP",
};

/** 绑定状态行文案（bind_state 列两取值；统一灰 #666 仅文字区分，2026-09-23 用户指定；
 *  bind_on_equip=装备后绑定（可交易地基）、bound=已绑定（不可交易）） */
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

/** 装备属性卡逐行内容（样式与原型描述文字一致；color 为品质色/未达标红） */
const equipLines = computed<{ text: string; color?: string }[]>(() => {
  const it = props.item;
  if (it.kind !== "equipment" || !it.equip) return [];
  const e = it.equip;
  const lines: { text: string; color?: string }[] = [];
  if (it.quality) {
    lines.push({ text: `品质：${QUALITY_NAMES[it.quality] ?? it.quality}`, color: QUALITY_COLORS[it.quality] });
  }
  // 绑定状态行（仅装备显示；消耗品/材料不出现该行）：两种取值统一灰 #666，仅文字区分
  lines.push({ text: `状态：${BIND_STATE_LABELS[it.bindState]}`, color: "#666666" });
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
</script>

<template>
  <div class="item-detail-win" role="dialog" aria-label="道具说明">
    <div class="item-head">
      <b>道具说明</b>
      <div class="win-btns">
        <button type="button" class="win-btn" title="关闭" @click="emit('close')">
          <svg viewBox="0 0 12 12"><g stroke="currentColor" stroke-width="2" stroke-linecap="square"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></g></svg>
        </button>
      </div>
    </div>
    <div class="item-body">
      <span class="item-figure">
        <img
          v-if="item.sprite && !broken"
          :src="item.sprite"
          :alt="item.name"
          @error="broken = true"
        />
        <span v-else class="ic-fallback lg" aria-hidden="true" v-html="fallbackIconOf(item)"></span>
      </span>
      <div class="item-info">
        <b>{{ item.name }}</b>
        <p>{{ item.desc || "（暂无描述。）" }}</p>
        <p
          v-for="(l, i) in equipLines"
          :key="i"
          :style="l.color ? { color: l.color } : undefined"
        >{{ l.text }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
.item-figure .ic-fallback { display: block; width: 52px; height: 52px; }
.item-figure .ic-fallback :deep(svg) { display: block; width: 52px; height: 52px; }
.item-info { min-width: 0; flex: 1; }
.item-info b { display: block; font: 600 14px/1.4 "Microsoft YaHei", sans-serif; color: #1e293b; margin-bottom: 5px; }
.item-info p { font: 12px/1.7 "Microsoft YaHei", sans-serif; color: #334155; white-space: pre-wrap; }
</style>

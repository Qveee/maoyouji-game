<script setup lang="ts">
import type { Character } from "../api";

defineProps<{ character: Character; petName: string }>();
defineEmits<{ switchView: [] }>();

const professionName = { warrior: "战士", mage: "法师" } as const;
</script>

<template>
  <main class="panel3d game">
    <header>冒险之旅</header>
    <div class="body">
      <h2>{{ character.name }} <small>Lv.{{ character.level }} {{ professionName[character.profession] }} · {{ petName }}</small></h2>
      <p class="stats">
        HP {{ character.hp }} ｜ SP {{ character.sp }} ｜ 体力 {{ character.vit }} 力量 {{ character.str }}
        敏捷 {{ character.agi }} 智力 {{ character.intel }} 精神 {{ character.spr }}
      </p>
      <p class="tip">已进入猫隐村的世界。地图与战斗将在下一切片点亮。</p>
      <button class="btn3d" @click="$emit('switchView')">切换角色</button>
    </div>
  </main>
</template>

<style scoped>
.game {
  max-width: 720px;
  margin: 40px auto;
}
.game header {
  padding: 10px 18px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(#6db6d8, #3d88ad);
  border-bottom: 2px solid #14506e;
}
.body { padding: 18px 22px; }
.body h2 { margin: 0 0 10px; color: #14506e; }
.body h2 small { font-size: 13px; font-weight: 400; color: #48788f; }
.stats {
  padding: 10px 12px;
  background: #e7f5fc;
  border: 1px solid #bfe0ef;
  border-radius: 6px;
}
.tip { color: #48788f; font-size: 13px; }
.panel3d {
  border: 2px solid #14506e;
  border-radius: 12px;
  background: linear-gradient(#fdfeff, #e9f6fc);
  box-shadow:
    0 0 0 5px rgba(255, 255, 255, 0.6),
    0 0 0 6px rgba(88, 177, 216, 0.5),
    0 14px 32px rgba(20, 80, 110, 0.22);
  overflow: hidden;
}
.btn3d {
  cursor: pointer;
  border-radius: 8px;
  border: 1px solid #14506e;
  padding: 8px 18px;
  font-size: 14px;
  font-family: inherit;
  color: #123c53;
  background: linear-gradient(#e7f6fd 0%, #b5ddf0 100%);
  box-shadow: inset 0 1px 0 #fff, 0 3px 0 #2c617e;
}
.btn3d:active { transform: translateY(2px); box-shadow: inset 0 1px 0 #fff, 0 1px 0 #2c617e; }
</style>

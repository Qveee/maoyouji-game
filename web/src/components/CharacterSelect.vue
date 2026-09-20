<script setup lang="ts">
import { computed, ref } from "vue";
import type { Character, Pet } from "../api";

const props = defineProps<{ characters: Character[]; pets: Pet[]; message: string }>();
const emit = defineEmits<{
  create: [name: string, breedCode: string, profession: "warrior" | "mage"];
  enter: [id: number];
  remove: [id: number];
}>();

const selectedPet = ref("mao");
const selectedProfession = ref<"warrior" | "mage">("warrior");
const characterName = ref("");
const submitting = ref(false);

const professionName = { warrior: "战士", mage: "法师" } as const;

const petGif = (pet: Pet) => `/pets/${encodeURIComponent(pet.sprite.split("/").pop() ?? "")}`;
const petOf = (code: string) => props.pets.find((p) => p.code === code);
const currentPet = computed(() => petOf(selectedPet.value) ?? props.pets[0]);

const statBars = computed(() => {
  const s = currentPet.value?.baseStats ?? {};
  return [
    { label: "体力", key: "vit", value: s.vit ?? 0 },
    { label: "力量", key: "str", value: s.str ?? 0 },
    { label: "敏捷", key: "agi", value: s.agi ?? 0 },
    { label: "智力", key: "intel", value: s.intel ?? 0 },
    { label: "精神", key: "spr", value: s.spr ?? 0 },
  ];
});

async function create() {
  if (submitting.value) return;
  submitting.value = true;
  emit("create", characterName.value, selectedPet.value, selectedProfession.value);
  submitting.value = false;
}

function remove(id: number) {
  if (window.confirm("确定要删除这个角色吗？删除后昵称将被释放。")) {
    emit("remove", id);
  }
}

defineExpose({ done: () => (submitting.value = false) });
</script>

<template>
  <main class="select">
    <section class="panel3d stage">
      <header>宠物预览</header>
      <div class="stage-body">
        <div class="pedestal">
          <img v-if="currentPet" :src="petGif(currentPet)" :alt="`${currentPet.name} 立绘`" />
        </div>
        <h2 v-if="currentPet">{{ currentPet.name }}</h2>
        <p v-if="currentPet" class="desc">{{ currentPet.description }}</p>

        <ul class="stats">
          <li v-for="bar in statBars" :key="bar.key">
            <span class="stat-label">{{ bar.label }}</span>
            <span class="stat-track"><i :style="{ width: `${Math.min(bar.value, 10) * 10}%` }"></i></span>
            <b class="stat-value">{{ bar.value }}</b>
          </li>
        </ul>
      </div>
    </section>

    <div class="right-col">
      <section class="panel3d roster">
        <header>我的角色（{{ characters.length }}/5）</header>
        <div class="roster-body">
          <table v-if="characters.length">
            <thead>
              <tr><th>名字</th><th>宠物</th><th>职业</th><th>等级</th><th class="ops">操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="c in characters" :key="c.id">
                <td><b>{{ c.name }}</b></td>
                <td>{{ petOf(c.breedCode)?.name ?? c.breedCode }}</td>
                <td>{{ professionName[c.profession] }}</td>
                <td>Lv.{{ c.level }}</td>
                <td class="ops">
                  <button class="btn3d small" @click="emit('enter', c.id)">进入</button>
                  <button class="btn3d small danger" @click="remove(c.id)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="tip">还没有角色，创建一个开始冒险吧！</p>
        </div>
      </section>

      <section v-if="characters.length < 5" class="panel3d create">
        <header>创建新角色</header>
        <div class="create-body">
          <p class="hint">选择一只宠物作为你的角色（左侧预览），并决定它的战斗流派：</p>

          <div class="pet-grid" role="listbox" aria-label="选择宠物">
            <button
              v-for="p in pets"
              :key="p.code"
              type="button"
              class="pet-card"
              :class="{ selected: p.code === selectedPet }"
              role="option"
              :aria-selected="p.code === selectedPet"
              @click="selectedPet = p.code"
            >
              <img :src="petGif(p)" :alt="p.name" />
              <span>{{ p.name }}</span>
            </button>
          </div>

          <div class="create-form">
            <div class="field grow">
              <label for="new-character-name">角色名</label>
              <input id="new-character-name" v-model="characterName" maxlength="16" minlength="2" required placeholder="2~16 个字符" />
            </div>

            <div class="field">
              <label>职业</label>
              <div class="prof-pick">
                <button type="button" class="prof" :class="{ selected: selectedProfession === 'warrior' }" @click="selectedProfession = 'warrior'">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6.9 17.1 3.5 20.5l-.9-1 1.4-1.3-1-1 1.4-1.4 1 1L16 6.2V3h5v5h-3.2L6.9 17.1zm9.5-11L8 14.5l1.5 1.5 8.4-8.4V5h-1.5z" />
                  </svg>
                  <b>战士</b>
                  <small>近战物理 · 力量成长</small>
                </button>
                <button type="button" class="prof" :class="{ selected: selectedProfession === 'mage' }" @click="selectedProfession = 'mage'">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 2 10.6 6.2 7 4.4 8.8 8 4.6 9.4 8.8 10.8 7 14.4l3.6-1.8L12 22h1.6l3.1-7.7 3.3 1.7-1.7-3.5 4-1.4-4.2-1.4 1.8-3.6-3.7 1.8L14.4 2H12zm1.2 3.6.9 3.1 3.1-.9-.9 3.1 3 .9-3 1.1 1.3 2.5-2.5-1.2-2.4 5.8V11l-2.6.9.9-3.1-3.1.9.9-3.1-2.6 1.3 1.5-1.5z" />
                  </svg>
                  <b>法师</b>
                  <small>远程法术 · 智力成长</small>
                </button>
              </div>
            </div>
          </div>

          <button class="btn3d primary" :disabled="submitting" @click="create">
            {{ submitting ? "创建中…" : "创建角色" }}
          </button>
          <p v-if="message" class="error" role="alert">{{ message }}</p>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.select {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 18px;
  max-width: 1080px;
  margin: 28px auto;
  padding: 0 16px;
  align-items: start;
}
@media (max-width: 900px) {
  .select { grid-template-columns: 1fr; }
}

.panel3d {
  border: 2px solid #14506e;
  border-radius: 12px;
  background: linear-gradient(#fdfeff, #e9f6fc);
  box-shadow:
    0 0 0 4px rgba(255, 255, 255, 0.6),
    0 0 0 5px rgba(88, 177, 216, 0.45),
    0 12px 28px rgba(20, 80, 110, 0.2);
  overflow: hidden;
}
.panel3d > header {
  padding: 8px 16px;
  font-weight: 700;
  font-size: 14px;
  color: #fff;
  letter-spacing: 2px;
  background: linear-gradient(#6db6d8, #3d88ad);
  border-bottom: 2px solid #14506e;
}

.stage-body {
  padding: 18px 18px 20px;
  text-align: center;
}
.pedestal {
  position: relative;
  display: grid;
  place-items: center;
  height: 200px;
  background:
    radial-gradient(140px 44px at 50% 82%, rgba(255, 255, 255, 0.85), transparent 70%),
    linear-gradient(#dcefff, #c3e4f5);
  border: 1px solid #a9d3e8;
  border-radius: 10px;
  box-shadow: inset 0 2px 8px rgba(20, 80, 110, 0.14);
}
.pedestal img {
  max-height: 160px;
  image-rendering: pixelated;
  filter: drop-shadow(0 6px 4px rgba(20, 80, 110, 0.3));
  animation: bounce 2.4s ease-in-out infinite;
}
@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
@media (prefers-reduced-motion: reduce) {
  .pedestal img { animation: none; }
}
.stage-body h2 {
  margin: 12px 0 2px;
  font-size: 22px;
  color: #14506e;
  letter-spacing: 3px;
}
.desc {
  margin: 0 0 14px;
  font-size: 12px;
  color: #48788f;
}

.stats { list-style: none; margin: 0; padding: 0; text-align: left; }
.stats li {
  display: grid;
  grid-template-columns: 34px 1fr 22px;
  gap: 8px;
  align-items: center;
  margin-bottom: 7px;
  font-size: 12px;
  color: #14506e;
}
.stat-track {
  height: 10px;
  background: #d5eaf5;
  border: 1px solid #a9d3e8;
  border-radius: 5px;
  overflow: hidden;
}
.stat-track i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #7fc4e8, #3d88ad);
  transition: width 240ms ease;
}
.stat-value { font-size: 12px; text-align: right; }

.roster-body { padding: 12px 16px; }
.roster table { width: 100%; border-collapse: collapse; }
.roster th, .roster td {
  padding: 8px 6px;
  font-size: 13px;
  text-align: left;
  border-bottom: 1px solid #d2e8f3;
}
.roster th { color: #48788f; font-weight: 600; font-size: 12px; }
.roster .ops { text-align: right; white-space: nowrap; }
.roster .ops .btn3d { margin-left: 6px; }

.btn3d {
  cursor: pointer;
  border-radius: 7px;
  border: 1px solid #14506e;
  padding: 6px 14px;
  font-size: 13px;
  font-family: inherit;
  color: #123c53;
  background: linear-gradient(#e7f6fd 0%, #b5ddf0 100%);
  box-shadow: inset 0 1px 0 #fff, 0 2px 0 #2c617e;
  transition: filter 160ms ease;
}
.btn3d:hover:not(:disabled) { filter: brightness(1.04); }
.btn3d:active:not(:disabled) { transform: translateY(1px); box-shadow: inset 0 1px 0 #fff, 0 1px 0 #2c617e; }
.btn3d.small { padding: 3px 10px; font-size: 12px; }
.btn3d.danger {
  color: #8c2f2f;
  border-color: #a34f4f;
  background: linear-gradient(#fdeaea, #f3c6c6);
  box-shadow: inset 0 1px 0 #fff, 0 2px 0 #7c3a3a;
}
.btn3d.primary {
  width: 100%;
  margin-top: 14px;
  padding: 10px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 5px;
  text-indent: 5px;
  color: #fff;
  text-shadow: 0 1px 0 rgba(9, 47, 68, 0.5);
  background: linear-gradient(#8fd0a8 0%, #4d9e6f 55%, #3c8a5d 100%);
  box-shadow: inset 0 1px 0 #d9f2e2, 0 3px 0 #2c6b47;
}
.btn3d:disabled { opacity: 0.6; cursor: wait; }

.tip { color: #48788f; font-size: 13px; margin: 4px 0; }

.create-body { padding: 14px 16px 18px; }
.hint { margin: 0 0 12px; font-size: 13px; color: #48788f; }

.pet-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 8px;
  margin-bottom: 16px;
}
.pet-card {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px 6px;
  font-family: inherit;
  font-size: 12px;
  color: #14506e;
  background: #f2faff;
  border: 1px solid #b9dcec;
  border-radius: 8px;
  transition: border-color 160ms ease, background-color 160ms ease, transform 160ms ease;
}
.pet-card:hover {
  border-color: #58b1d8;
  background: #e4f5fd;
  transform: translateY(-2px);
}
.pet-card.selected {
  border: 2px solid #d9a441;
  background: #fdf6e3;
  box-shadow: 0 0 0 2px rgba(217, 164, 65, 0.35), 0 3px 8px rgba(20, 80, 110, 0.16);
}
.pet-card img {
  width: 52px;
  height: 52px;
  object-fit: contain;
  image-rendering: pixelated;
}

.create-form {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
.field { flex: 1; min-width: 180px; }
.field label {
  display: block;
  margin-bottom: 5px;
  font-size: 13px;
  font-weight: 600;
  color: #14506e;
}
.field input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  font-size: 14px;
  color: #0f3a52;
  background: #fff;
  border: 1px solid #7fb8d4;
  border-radius: 6px;
  box-shadow: inset 0 2px 4px rgba(20, 80, 110, 0.12);
}
.field input:focus {
  outline: none;
  border-color: #2f7fa8;
  box-shadow: inset 0 2px 4px rgba(20, 80, 110, 0.12), 0 0 0 3px rgba(88, 177, 216, 0.35);
}

.prof-pick { display: flex; gap: 10px; }
.prof {
  cursor: pointer;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 8px 8px;
  font-family: inherit;
  color: #14506e;
  background: #f2faff;
  border: 1px solid #b9dcec;
  border-radius: 8px;
  transition: border-color 160ms ease, background-color 160ms ease;
}
.prof svg {
  width: 26px;
  height: 26px;
  fill: #3d88ad;
}
.prof small { font-size: 11px; color: #48788f; }
.prof:hover { border-color: #58b1d8; background: #e4f5fd; }
.prof.selected {
  border: 2px solid #3d88ad;
  background: #dcefff;
  box-shadow: 0 0 0 2px rgba(61, 136, 173, 0.25);
}

.error {
  margin: 10px 0 0;
  padding: 8px 10px;
  font-size: 13px;
  color: #8c2f2f;
  background: #fdeaea;
  border: 1px solid #e4b3b3;
  border-radius: 6px;
}
</style>

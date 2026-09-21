<script setup lang="ts">
/**
 * 选角视图（App 状态机 select）：内含「选择角色」与「创建角色」两个子视图
 * （对应原型 charView / createView），共用 ImmersiveStage 木框面板，标题带文字随子视图切换。
 * - 选角：char-card 网格（宠物图/角色名/Lv·职业，sel 高亮）+ 开始游戏/创建角色/删除角色/退出登录
 * - 创建：左侧舞台预览（图/名/描述/五维条）+ 右侧宠物网格（sel 联动舞台）+ 角色名 + 职业选择
 * - 创建成功后由父组件 refresh 带回新列表（服务端按 id 升序，新角色在末尾），自动落回选角并选中
 */
import { computed, ref, watch } from "vue";
import ImmersiveStage from "./ImmersiveStage.vue";
import { petGifOf } from "../pets";
import type { Character, Pet } from "../api";

const props = defineProps<{ characters: Character[]; pets: Pet[]; message: string }>();
const emit = defineEmits<{
  create: [name: string, breedCode: string, profession: "warrior" | "mage"];
  enter: [id: number];
  remove: [id: number];
  logout: [];
}>();

const stage = ref<InstanceType<typeof ImmersiveStage> | null>(null);
function toast(msg: string) {
  stage.value?.toast(msg);
}

const professionName = { warrior: "战士", mage: "法师" } as const;

/** 角色数上限（与服务端 characters 路由的上限对齐） */
const MAX_CHARACTERS = 5;

/* ---- 宠物静态数据工具 ---- */
const petOf = (code: string) => props.pets.find((p) => p.code === code);
const petNameOf = (code: string) => petOf(code)?.name ?? code;

/* ---- 子视图切换：char 选角 / create 创建，标题带随之切换 ---- */
const sub = ref<"char" | "create">("char");
const title = computed(() => (sub.value === "char" ? "选择角色" : "创建角色"));

/* ---- 选角 ---- */
const selIndex = ref(0);
const selChar = computed(() => props.characters[selIndex.value] ?? null);

/* 创建成功：列表变长 → 选中末尾新角色并落回选角子视图；删除失败等：收紧选中下标。
 * 注意：任何列表增长都会跳回选角页；若未来引入轮询/多标签同步，需改为比对新建角色 id（App 传回） */
watch(
  () => props.characters.length,
  (n, old) => {
    if (n > old) {
      selIndex.value = n - 1;
      sub.value = "char";
    } else if (selIndex.value >= n) {
      selIndex.value = Math.max(0, n - 1);
    }
  },
);

function startGame() {
  if (!selChar.value) {
    toast("请先选中角色");
    return;
  }
  emit("enter", selChar.value.id);
}
function removeChar() {
  if (!selChar.value) {
    toast("请先点击选中要删除的角色");
    return;
  }
  if (window.confirm(`确定要删除角色「${selChar.value.name}」吗？删除后昵称将被释放。`)) {
    emit("remove", selChar.value.id);
  }
}
function gotoCreate() {
  if (props.characters.length >= MAX_CHARACTERS) {
    toast(`每个账号最多 ${MAX_CHARACTERS} 个角色`);
    return;
  }
  characterName.value = "";
  sub.value = "create";
}

/* ---- 创建角色 ---- */
const selectedPetCode = ref(props.pets[0]?.code ?? "mao");
const selectedProfession = ref<"warrior" | "mage">("warrior");
const characterName = ref("");

/* 舞台预览联动宠物网格选中项；五维条宽 = min(baseStats, 10) × 10% */
const selPet = computed(() => petOf(selectedPetCode.value) ?? props.pets[0]);
const statRows = computed(() => {
  const s = selPet.value?.baseStats ?? {};
  return [
    { label: "体力", value: s.vit ?? 0 },
    { label: "力量", value: s.str ?? 0 },
    { label: "敏捷", value: s.agi ?? 0 },
    { label: "智力", value: s.intel ?? 0 },
    { label: "精神", value: s.spr ?? 0 },
  ];
});

function confirmCreate() {
  const name = characterName.value.trim();
  if (name.length < 2 || name.length > 16) {
    toast("角色名需要 2~16 个字符");
    return;
  }
  if (!selPet.value) {
    toast("请选择一只宠物");
    return;
  }
  emit("create", name, selPet.value.code, selectedProfession.value);
}
function backToChar() {
  sub.value = "char";
}
</script>

<template>
  <ImmersiveStage ref="stage" :title="title" :message="message">
    <!-- 子视图：选择角色 -->
    <div v-if="sub === 'char'" class="view">
      <h2 class="vtitle">请选择角色</h2>
      <div class="char-list">
        <template v-if="characters.length">
          <div
            v-for="(c, i) in characters"
            :key="c.id"
            class="char-card"
            :class="{ sel: i === selIndex }"
            @click="selIndex = i"
          >
            <img :src="petGifOf(petOf(c.breedCode))" :alt="petNameOf(c.breedCode)" />
            <b>{{ c.name }}</b>
            <i>Lv.{{ c.level }} · {{ professionName[c.profession] }}</i>
          </div>
        </template>
        <p v-else class="char-empty">还没有角色，点击「创建角色」开始冒险吧！</p>
      </div>
      <div class="ops">
        <button class="btn-big gold" type="button" @click="startGame">开始游戏</button>
        <button class="btn-big brown" type="button" @click="gotoCreate">创建角色</button>
        <button class="btn-big red" type="button" @click="removeChar">删除角色</button>
        <!-- 退出登录：从原 App 顶栏挪入（原型无，必要新增） -->
        <button class="btn-big brown" type="button" @click="emit('logout')">退出登录</button>
      </div>
    </div>

    <!-- 子视图：创建角色 -->
    <div v-else class="view">
      <div class="create-grid">
        <!-- 左：舞台预览（图/名/描述/五维条） -->
        <div class="stage-box">
          <img v-if="selPet" :src="petGifOf(selPet)" :alt="selPet.name" />
          <b>{{ selPet?.name }}</b>
          <p>{{ selPet?.description }}</p>
          <div v-for="row in statRows" :key="row.label" class="stat">
            <span>{{ row.label }}</span>
            <span class="tr"><i :style="{ width: Math.min(row.value, 10) * 10 + '%' }"></i></span>
            <b>{{ row.value }}</b>
          </div>
        </div>
        <!-- 右：宠物网格 + 表单 + 操作 -->
        <div class="cright">
          <div class="pet-grid">
            <div
              v-for="p in pets"
              :key="p.code"
              class="pet-card"
              :class="{ sel: p.code === selectedPetCode }"
              @click="selectedPetCode = p.code"
            >
              <img :src="petGifOf(p)" :alt="p.name" />
              <span>{{ p.name }}</span>
            </div>
          </div>
          <div class="cform">
            <div class="field">
              <label>角色名</label>
              <input
                v-model="characterName"
                class="txt"
                maxlength="16"
                placeholder="2~16 个字符"
                @keydown.enter.prevent="confirmCreate"
              />
            </div>
            <div class="field">
              <label>职业</label>
              <div class="prof-pick">
                <div class="prof" :class="{ sel: selectedProfession === 'warrior' }" @click="selectedProfession = 'warrior'">
                  战士<small>近战物理</small>
                </div>
                <div class="prof" :class="{ sel: selectedProfession === 'mage' }" @click="selectedProfession = 'mage'">
                  法师<small>远程法术</small>
                </div>
              </div>
            </div>
          </div>
          <div class="cops">
            <button class="btn-mid gold" type="button" @click="confirmCreate">确认创建</button>
            <button class="btn-mid brown" type="button" @click="backToChar">返回上一页</button>
          </div>
        </div>
      </div>
    </div>
  </ImmersiveStage>
</template>

<style scoped>
/* 说明：.view / .vtitle / .btn-big / .txt 为三视图共享原语，统一收在 ImmersiveStage.vue
   的非 scoped 块（.scene 前缀），此处只留本组件差异覆盖。 */

/* ---- 角色卡片网格 ---- */
.char-list {
  display: flex;
  flex-wrap: wrap;
  gap: 22px;
  justify-content: center;
  min-height: 230px;
  padding: 6px 0 2px;
}
.char-card {
  width: 158px;
  padding: 10px 6px 9px;
  text-align: center;
  cursor: pointer;
  position: relative;
  border: 3px solid #a87718;
  border-radius: 12px;
  background: linear-gradient(180deg, var(--news-a), var(--news-b));
  box-shadow: 0 3px 0 rgba(90, 50, 0, 0.35), inset 0 1px 0 #fff6c8;
  transition: filter 0.15s ease, transform 0.15s ease;
}
.char-card:hover {
  filter: brightness(1.05);
}
.char-card.sel {
  border-color: #d63a2a;
  transform: translateY(-3px);
  box-shadow: 0 0 0 3px rgba(214, 58, 42, 0.35), 0 6px 10px rgba(90, 50, 0, 0.3);
}
.char-card img {
  width: 96px;
  height: 96px;
  object-fit: contain;
  image-rendering: pixelated;
  filter: drop-shadow(0 4px 3px rgba(90, 50, 0, 0.35));
}
.char-card b {
  display: block;
  font-size: 15px;
  color: var(--ink-brown);
  margin-top: 2px;
}
.char-card i {
  display: block;
  font-style: normal;
  font-size: 12px;
  color: #7a5a20;
}
.char-empty {
  align-self: center;
  font-size: 14px;
  color: #7a5a20;
}

/* ---- 大按钮排（开始游戏/创建角色/删除角色/退出登录） ---- */
.ops {
  display: flex;
  justify-content: center;
  gap: 18px;
  margin-top: 18px;
}

/* ---- 中按钮（确认创建/返回上一页） ---- */
.btn-mid {
  cursor: pointer;
  font-family: "STHupo", "华文琥珀", "SimSun", sans-serif;
  font-size: 14px;
  letter-spacing: 4px;
  text-indent: 4px;
  padding: 6px 16px;
  border-radius: 7px;
  border: 2px solid var(--brown-line);
}
.btn-mid.gold {
  color: var(--red-word);
  background: linear-gradient(180deg, var(--btn-gold-a), var(--btn-gold-b));
  box-shadow: inset 0 2px 0 #fff6c8, 0 3px 0 #7a4a10, 0 5px 8px rgba(80, 40, 0, 0.3);
}
.btn-mid.brown {
  color: var(--brown-text);
  background: linear-gradient(180deg, var(--brown-a), var(--brown-b));
  box-shadow: inset 0 1px 0 rgba(255, 240, 200, 0.4), 0 3px 0 #3e2208, 0 5px 8px rgba(50, 25, 0, 0.3);
}
.btn-mid:active {
  transform: translateY(1px);
}

/* ---- 创建角色视图 ---- */
.create-grid {
  display: grid;
  grid-template-columns: 218px 1fr;
  gap: 18px;
  height: 100%;
}
.stage-box {
  border: 4px solid var(--news-frame);
  border-radius: 12px;
  padding: 9px;
  text-align: center;
  background:
    radial-gradient(160px 60px at 50% 78%, rgba(255, 255, 255, 0.75), transparent 70%),
    linear-gradient(180deg, #eaf7ff, #cfe9f5);
  box-shadow: inset 0 2px 8px rgba(20, 80, 110, 0.15);
}
.stage-box img {
  width: 118px;
  height: 118px;
  object-fit: contain;
  image-rendering: pixelated;
  filter: drop-shadow(0 8px 5px rgba(20, 80, 110, 0.3));
}
.stage-box b {
  display: block;
  font-size: 15px;
  color: var(--ink-navy);
  margin-top: 3px;
  letter-spacing: 2px;
}
.stage-box p {
  margin: 3px 8px 0;
  font-size: 11px;
  color: #48788f;
}
.stat {
  display: grid;
  grid-template-columns: 34px 1fr 24px;
  gap: 7px;
  align-items: center;
  margin: 5px 8px 0;
  font-size: 11px;
  color: var(--ink-navy);
}
.stat .tr {
  height: 10px;
  background: #c7e2ef;
  border: 1px solid #a9c8da;
  border-radius: 5px;
  overflow: hidden;
}
.stat .tr i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #7fc4e8, #2f7fa8);
}
.pet-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(86px, 1fr));
  gap: 8px;
  max-height: 286px;
  overflow-y: auto;
  padding: 4px;
}
.pet-card {
  cursor: pointer;
  padding: 8px 4px 6px;
  text-align: center;
  border: 2px solid #b9d8c8;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.55);
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.pet-card:hover {
  border-color: var(--link-blue);
  background: #eaf6ff;
}
.pet-card.sel {
  border-color: #d8921c;
  background: #fff4d6;
  box-shadow: 0 0 0 2px rgba(216, 146, 28, 0.35);
}
.pet-card img {
  width: 56px;
  height: 56px;
  object-fit: contain;
  image-rendering: pixelated;
}
.pet-card span {
  display: block;
  font-size: 12px;
  color: var(--ink-brown);
  margin-top: 2px;
}
.cright {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.cform {
  display: flex;
  gap: 36px;
  flex-wrap: wrap;
  margin-top: 18px;
  align-items: flex-start;
}
.cform .field label {
  display: block;
  width: 4em;
  font-size: 13px;
  margin-bottom: 5px;
  color: #6b4e1e;
}
.cform .txt {
  width: 170px;
}
.cops {
  display: flex;
  justify-content: center;
  gap: 64px;
  margin-top: auto;
  padding-top: 22px;
}
.prof-pick {
  display: flex;
  gap: 10px;
}
.prof {
  cursor: pointer;
  padding: 7px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--ink-brown);
  border: 2px solid #b9d8c8;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.55);
}
.prof small {
  display: block;
  color: #8b7b55;
  font-size: 11px;
}
.prof.sel {
  border-color: #b01f14;
  background: #ffe3dc;
  box-shadow: 0 0 0 2px rgba(176, 31, 20, 0.25);
}
</style>

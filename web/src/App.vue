<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, type Character, type Pet } from "./api";
import { petGifOf } from "./pets";
import LoginPanel from "./components/LoginPanel.vue";
import CharacterSelect from "./components/CharacterSelect.vue";
import GameShell from "./components/GameShell.vue";

type View = "loading" | "auth" | "select" | "game";

const view = ref<View>("loading");
const username = ref("");
const characters = ref<Character[]>([]);
const pets = ref<Pet[]>([]);
const current = ref<Character | null>(null);
const message = ref("");

const currentPetGif = computed(() => petGifOf(pets.value.find((p) => p.code === current.value?.breedCode)));

async function refresh(keepView = false) {
  try {
    if (pets.value.length === 0) {
      pets.value = (await api.pets()).pets;
    }
    const me = await api.me();
    username.value = me.username;
    const list = await api.characters();
    characters.value = list.characters;
    current.value = list.characters.find((c) => c.id === me.characterId) ?? null;
    // keepView：建角后刷新时保持在选角视图（角色列表已更新，由 CharacterSelect 选中新角色），
    // 避免旧 characterId 仍指向原角色而把界面劫持回游戏内
    if (!keepView || view.value === "loading") {
      view.value = me.characterId && current.value ? "game" : "select";
    }
  } catch {
    view.value = "auth";
  }
}

async function submitAuth(mode: "login" | "register", user: string, password: string) {
  message.value = "";
  try {
    if (mode === "login") {
      await api.login(user, password);
    } else {
      await api.register(user, password);
    }
    if (pets.value.length === 0) {
      pets.value = (await api.pets()).pets;
    }
    await refresh();
  } catch (err) {
    message.value = err instanceof Error ? err.message : "操作失败";
  }
}

async function logout() {
  await api.logout();
  view.value = "auth";
  current.value = null;
  message.value = "";
}

async function createCharacter(name: string, breedCode: string, profession: "warrior" | "mage") {
  message.value = "";
  try {
    await api.createCharacter(name, breedCode, profession);
    await refresh(true);
  } catch (err) {
    message.value = err instanceof Error ? err.message : "创建失败";
  }
}

async function enter(id: number) {
  message.value = "";
  try {
    await api.selectCharacter(id);
    await refresh();
  } catch (err) {
    message.value = err instanceof Error ? err.message : "进入失败";
  }
}

async function remove(id: number) {
  message.value = "";
  try {
    await api.deleteCharacter(id);
    // keepView：删除后留在选角页——被删角色未必是当前选中的，刷新若发现
    // 旧 characterId 仍有效会把用户弹进游戏视图
    await refresh(true);
  } catch (err) {
    message.value = err instanceof Error ? err.message : "删除失败";
  }
}

onMounted(refresh);
</script>

<template>
  <!-- auth 与 select 复用原型沉浸式场景（背景/木框面板由 ImmersiveStage 提供），仅 game 视图保留天蓝页面底 -->
  <div class="app" :class="{ immersive: view === 'auth' || view === 'select' }">
    <div v-if="view === 'loading'" class="loading">加载中…</div>

    <LoginPanel v-else-if="view === 'auth'" :message="message" @submit="submitAuth" />

    <CharacterSelect
      v-else-if="view === 'select'"
      :characters="characters"
      :pets="pets"
      :message="message"
      @create="createCharacter"
      @enter="enter"
      @remove="remove"
      @logout="logout"
    />

    <GameShell
      v-else-if="view === 'game' && current"
      :username="username"
      :character="current"
      :pet-gif="currentPetGif"
      @switch-view="view = 'select'"
      @character-changed="refresh"
    />
  </div>
</template>

<style>
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Microsoft YaHei", "SimSun", sans-serif;
  color: #14506e;
}

.app:not(.immersive) {
  min-height: 100vh;
  background:
    radial-gradient(900px 380px at 20% -8%, #ffffffaa, transparent 60%),
    linear-gradient(#a8dcf3, #d8f2fc 70%);
}

.loading {
  min-height: 100vh;
  display: grid;
  place-items: center;
  color: #48788f;
  letter-spacing: 2px;
}
</style>

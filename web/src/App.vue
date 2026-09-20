<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, type Character, type Pet } from "./api";
import LoginPanel from "./components/LoginPanel.vue";
import CharacterSelect from "./components/CharacterSelect.vue";
import GamePanel from "./components/GamePanel.vue";

type View = "loading" | "auth" | "select" | "game";

const view = ref<View>("loading");
const username = ref("");
const characters = ref<Character[]>([]);
const pets = ref<Pet[]>([]);
const current = ref<Character | null>(null);
const message = ref("");

const petNameOf = (code: string) => pets.value.find((p) => p.code === code)?.name ?? code;

async function refresh() {
  try {
    if (pets.value.length === 0) {
      pets.value = (await api.pets()).pets;
    }
    const me = await api.me();
    username.value = me.username;
    const list = await api.characters();
    characters.value = list.characters;
    current.value = list.characters.find((c) => c.id === me.characterId) ?? null;
    view.value = me.characterId && current.value ? "game" : "select";
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
}

async function createCharacter(name: string, breedCode: string, profession: "warrior" | "mage") {
  message.value = "";
  try {
    await api.createCharacter(name, breedCode, profession);
    await refresh();
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
    await refresh();
  } catch (err) {
    message.value = err instanceof Error ? err.message : "删除失败";
  }
}

onMounted(refresh);
</script>

<template>
  <div class="app" :class="{ immersive: view === 'auth' }">
    <header v-if="view === 'select' || view === 'game'" class="topbar">
      <b class="brand">喵游记</b>
      <span class="who">冒险者：{{ username }}</span>
      <a href="#" @click.prevent="logout">退出登录</a>
    </header>

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
    />

    <GamePanel
      v-else-if="view === 'game' && current"
      :character="current"
      :pet-name="petNameOf(current.breedCode)"
      @switch-view="view = 'select'"
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

.topbar {
  display: flex;
  gap: 18px;
  align-items: center;
  padding: 8px 18px;
  background: linear-gradient(#3d88ad, #2c617e);
  color: #fff;
  box-shadow: 0 2px 8px rgba(20, 80, 110, 0.35);
}
.topbar .brand {
  font-family: "STKaiti", "KaiTi", "SimSun", serif;
  font-size: 20px;
  letter-spacing: 4px;
  text-shadow: 0 1px 0 rgba(9, 47, 68, 0.6);
}
.topbar .who { flex: 1; font-size: 13px; opacity: 0.9; }
.topbar a { color: #cde9f5; font-size: 13px; }

.loading {
  min-height: 100vh;
  display: grid;
  place-items: center;
  color: #48788f;
  letter-spacing: 2px;
}
</style>

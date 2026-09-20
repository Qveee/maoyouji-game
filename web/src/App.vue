<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, type Character, type Pet } from "./api";

type View = "loading" | "auth" | "select" | "game";

const view = ref<View>("loading");
const username = ref("");
const characters = ref<Character[]>([]);
const pets = ref<Pet[]>([]);
const characterName = ref("");
const current = ref<Character | null>(null);
const message = ref("");
const authMode = ref<"login" | "register">("login");
const authUsername = ref("");
const authPassword = ref("");
const selectedPet = ref("mao");
const selectedProfession = ref<"warrior" | "mage">("warrior");

const professionName = { warrior: "战士", mage: "法师" } as const;
const petName = (code: string) => pets.value.find((p) => p.code === code)?.name ?? code;

async function refresh() {
  try {
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

async function submitAuth() {
  message.value = "";
  try {
    if (authMode.value === "login") {
      await api.login(authUsername.value, authPassword.value);
    } else {
      await api.register(authUsername.value, authPassword.value);
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

async function createCharacter() {
  message.value = "";
  try {
    await api.createCharacter(characterName.value, selectedPet.value, selectedProfession.value);
    characterName.value = "";
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
  <div class="app">
    <header v-if="view !== 'loading'" class="topbar">
      <b>喵游记</b>
      <span v-if="username">账号：{{ username }}</span>
      <a v-if="view !== 'auth'" href="#" @click.prevent="logout">退出登录</a>
    </header>

    <main v-if="view === 'loading'" class="panel">加载中…</main>

    <main v-else-if="view === 'auth'" class="panel auth">
      <h2>{{ authMode === "login" ? "登录" : "注册新账号" }}</h2>
      <form @submit.prevent="submitAuth">
        <label>用户名<input v-model="authUsername" autocomplete="username" required /></label>
        <label>密码<input v-model="authPassword" type="password" autocomplete="current-password" required /></label>
        <button type="submit">{{ authMode === "login" ? "登录" : "注册并登录" }}</button>
      </form>
      <p class="tip">
        <a href="#" @click.prevent="authMode = authMode === 'login' ? 'register' : 'login'">
          {{ authMode === "login" ? "没有账号？注册" : "已有账号？登录" }}
        </a>
      </p>
      <p v-if="message" class="error">{{ message }}</p>
    </main>

    <main v-else-if="view === 'select'" class="panel select">
      <section>
        <h2>我的角色（{{ characters.length }}/5）</h2>
        <table v-if="characters.length">
          <thead><tr><th>名字</th><th>宠物</th><th>职业</th><th>等级</th><th></th></tr></thead>
          <tbody>
            <tr v-for="c in characters" :key="c.id">
              <td><b>{{ c.name }}</b></td>
              <td>{{ petName(c.breedCode) }}</td>
              <td>{{ professionName[c.profession] }}</td>
              <td>Lv.{{ c.level }}</td>
              <td>
                <button @click="enter(c.id)">进入</button>
                <button class="danger" @click="remove(c.id)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="tip">还没有角色，先领养一只宠物吧！</p>
      </section>

      <section v-if="characters.length < 5">
        <h2>领养新宠物</h2>
        <form class="create" @submit.prevent="createCharacter">
          <label>名字<input v-model="characterName" maxlength="16" required placeholder="2~16 字" /></label>
          <label>宠物
            <select v-model="selectedPet">
              <option v-for="p in pets" :key="p.code" :value="p.code">{{ p.name }}（{{ p.description }}）</option>
            </select>
          </label>
          <label>职业
            <select v-model="selectedProfession">
              <option value="warrior">战士（近战物理）</option>
              <option value="mage">法师（远程法术）</option>
            </select>
          </label>
          <button type="submit">领养</button>
        </form>
      </section>
      <p v-if="message" class="error">{{ message }}</p>
    </main>

    <main v-else class="panel game">
      <h2>{{ current?.name }} <small>Lv.{{ current?.level }} {{ current ? professionName[current.profession] : "" }}</small></h2>
      <p class="stats" v-if="current">
        HP {{ current.hp }} ｜ SP {{ current.sp }} ｜ 体力 {{ current.vit }} 力量 {{ current.str }}
        敏捷 {{ current.agi }} 智力 {{ current.intel }} 精神 {{ current.spr }}
      </p>
      <p class="tip">已进入猫隐村的世界。地图与战斗将在下一切片点亮。</p>
      <button @click="view = 'select'">切换角色</button>
    </main>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  font-family: "Microsoft YaHei", "SimSun", sans-serif;
  color: #14506e;
  background: linear-gradient(#cde9f5, #aed7ea);
}
.topbar {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 6px 12px;
  background: #14506e;
  color: #fff;
}
.topbar a { color: #cde9f5; }
.panel {
  max-width: 720px;
  margin: 32px auto;
  padding: 20px 24px;
  background: #f4fbff;
  border: 2px solid #58b1d8;
  border-radius: 6px;
}
.panel h2 { margin-top: 0; }
label { display: block; margin: 8px 0; }
input, select {
  margin-left: 8px;
  padding: 3px 6px;
  border: 1px solid #58b1d8;
}
button {
  margin-top: 8px;
  padding: 4px 14px;
  border: 1px solid #14506e;
  background: #cde9f5;
  cursor: pointer;
}
button.danger { border-color: #a33; color: #a33; }
.tip { color: #48788f; font-size: 13px; }
.error { color: #a33; }
table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
th, td { padding: 6px 8px; border-bottom: 1px solid #bfe0ef; text-align: left; }
.create { max-width: 420px; }
.stats { background: #e7f5fc; padding: 8px 10px; }
</style>

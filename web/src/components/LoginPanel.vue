<script setup lang="ts">
import { ref } from "vue";

defineProps<{ message: string }>();
const emit = defineEmits<{ submit: [mode: "login" | "register", username: string, password: string] }>();

const mode = ref<"login" | "register">("login");
const username = ref("");
const password = ref("");
const submitting = ref(false);

async function submit() {
  if (submitting.value) return;
  submitting.value = true;
  emit("submit", mode.value, username.value, password.value);
  submitting.value = false;
}

function done() {
  // 由父组件通过重新挂载/刷新控制；此处仅恢复按钮
  submitting.value = false;
}
defineExpose({ done });
</script>

<template>
  <div class="login-scene">
    <div class="cloud c1"></div>
    <div class="cloud c2"></div>
    <div class="cloud c3"></div>

    <section class="panel3d login-card">
      <header>
        <svg class="paw" viewBox="0 0 24 24" aria-hidden="true">
          <ellipse cx="12" cy="15.5" rx="4.6" ry="4" />
          <ellipse cx="5.6" cy="10.5" rx="2.1" ry="2.7" />
          <ellipse cx="10" cy="7" rx="2.1" ry="2.8" />
          <ellipse cx="14.4" cy="7" rx="2.1" ry="2.8" />
          <ellipse cx="18.6" cy="10.5" rx="2.1" ry="2.7" />
        </svg>
        <h1>喵游记</h1>
        <p class="tagline">多人在线网页宠物养成 RPG · 经典页游复刻</p>
      </header>

      <form @submit.prevent="submit">
        <div class="field">
          <label for="login-username">冒险者账号</label>
          <input id="login-username" v-model="username" autocomplete="username" required placeholder="2~32 个字符" />
        </div>
        <div class="field">
          <label for="login-password">密码</label>
          <input id="login-password" v-model="password" type="password" autocomplete="current-password" required minlength="6" placeholder="至少 6 位" />
        </div>

        <button class="btn3d primary" type="submit" :disabled="submitting">
          {{ submitting ? "登入中…" : mode === "login" ? "进入游戏" : "注册并进入" }}
        </button>
      </form>

      <p class="switch">
        <a href="#" @click.prevent="mode = mode === 'login' ? 'register' : 'login'">
          {{ mode === "login" ? "还没有账号？注册一个 →" : "已有账号？直接登录 →" }}
        </a>
      </p>
      <p v-if="message" class="error" role="alert">{{ message }}</p>

      <footer>v0.1.0 · 单机核心循环开发中 · 仅供学习复刻</footer>
    </section>
  </div>
</template>

<style scoped>
.login-scene {
  position: relative;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background:
    radial-gradient(1200px 500px at 70% -10%, #ffffff88, transparent 60%),
    linear-gradient(#7fc4e8 0%, #a8dcf3 45%, #d8f2fc 100%);
  overflow: hidden;
}

.cloud {
  position: absolute;
  background: #ffffffd9;
  border-radius: 999px;
  filter: blur(1px);
}
.cloud::before,
.cloud::after {
  content: "";
  position: absolute;
  background: inherit;
  border-radius: 999px;
}
.c1 { width: 220px; height: 54px; top: 12%; left: 8%; animation: drift 14s ease-in-out infinite alternate; }
.c1::before { width: 90px; height: 90px; top: -42px; left: 36px; }
.c1::after { width: 64px; height: 64px; top: -28px; right: 34px; }
.c2 { width: 160px; height: 40px; top: 24%; right: 12%; animation: drift 18s ease-in-out infinite alternate-reverse; }
.c2::before { width: 64px; height: 64px; top: -30px; left: 26px; }
.c2::after { width: 46px; height: 46px; top: -20px; right: 24px; }
.c3 { width: 120px; height: 32px; bottom: 18%; left: 16%; animation: drift 11s ease-in-out infinite alternate; }
.c3::before { width: 48px; height: 48px; top: -22px; left: 20px; }
.c3::after { width: 34px; height: 34px; top: -15px; right: 18px; }
@keyframes drift {
  from { transform: translateX(-14px); }
  to { transform: translateX(14px); }
}
@media (prefers-reduced-motion: reduce) {
  .cloud { animation: none; }
}

.panel3d {
  border: 2px solid #14506e;
  border-radius: 12px;
  background: linear-gradient(#fdfeff, #e9f6fc);
  box-shadow:
    0 0 0 5px rgba(255, 255, 255, 0.6),
    0 0 0 6px rgba(88, 177, 216, 0.5),
    0 18px 40px rgba(20, 80, 110, 0.28);
  overflow: hidden;
}

.login-card {
  width: min(400px, 100%);
  animation: float-in 360ms ease-out;
}
@keyframes float-in {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}

.login-card header {
  padding: 26px 28px 18px;
  text-align: center;
  background:
    linear-gradient(180deg, #6db6d8 0%, #3d88ad 100%);
  color: #fff;
  border-bottom: 2px solid #14506e;
}
.login-card h1 {
  margin: 6px 0 4px;
  font-family: "STKaiti", "KaiTi", "SimSun", serif;
  font-size: 44px;
  letter-spacing: 10px;
  text-indent: 10px;
  text-shadow: 0 2px 0 rgba(9, 47, 68, 0.6), 0 0 18px rgba(255, 255, 255, 0.45);
}
.tagline {
  margin: 0;
  font-size: 12px;
  letter-spacing: 2px;
  opacity: 0.92;
}
.paw {
  width: 30px;
  height: 30px;
  fill: #fdf4dd;
  filter: drop-shadow(0 1px 1px rgba(9, 47, 68, 0.5));
}

.login-card form {
  padding: 22px 28px 6px;
}
.field { margin-bottom: 14px; }
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
  padding: 9px 12px;
  font-size: 14px;
  color: #0f3a52;
  background: #fff;
  border: 1px solid #7fb8d4;
  border-radius: 6px;
  box-shadow: inset 0 2px 4px rgba(20, 80, 110, 0.12);
  transition: border-color 160ms ease, box-shadow 160ms ease;
}
.field input:focus {
  outline: none;
  border-color: #2f7fa8;
  box-shadow: inset 0 2px 4px rgba(20, 80, 110, 0.12), 0 0 0 3px rgba(88, 177, 216, 0.35);
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
  transition: filter 160ms ease, box-shadow 160ms ease, transform 80ms ease;
}
.btn3d:hover:not(:disabled) { filter: brightness(1.04); }
.btn3d:active:not(:disabled) {
  transform: translateY(2px);
  box-shadow: inset 0 1px 0 #fff, 0 1px 0 #2c617e;
}
.btn3d:disabled { opacity: 0.6; cursor: wait; }
.btn3d.primary {
  width: 100%;
  margin-top: 4px;
  padding: 11px;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 6px;
  text-indent: 6px;
  color: #fff;
  text-shadow: 0 1px 0 rgba(9, 47, 68, 0.5);
  background: linear-gradient(#8fd0a8 0%, #4d9e6f 55%, #3c8a5d 100%);
  box-shadow: inset 0 1px 0 #d9f2e2, 0 3px 0 #2c6b47;
}

.switch {
  margin: 14px 28px 0;
  font-size: 13px;
  text-align: center;
}
.switch a { color: #2f7fa8; }
.error {
  margin: 10px 28px 0;
  padding: 8px 10px;
  font-size: 13px;
  color: #8c2f2f;
  background: #fdeaea;
  border: 1px solid #e4b3b3;
  border-radius: 6px;
}
.login-card footer {
  margin-top: 18px;
  padding: 10px 28px 14px;
  font-size: 11px;
  color: #6f93a6;
  text-align: center;
  border-top: 1px dashed #b9dcec;
}
</style>

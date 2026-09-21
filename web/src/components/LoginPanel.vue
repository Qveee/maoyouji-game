<script setup lang="ts">
/**
 * 登录视图（App 状态机 auth）：照 prototype/登录页.html 登录视图逐字复刻。
 * - 服务器行（猫隐一区/更换服务器循环切换，纯视觉占位）
 * - 算式验证码：客户端随机个位加法（原型 genCap 同款，提交前本地校验）
 * - 注册模式（新增，原型无）：点「新用户注册」切出注册表单，确认密码不一致前端拦截
 * - 服务器行为全部经 emit("submit", mode, username, password) 交给 App 调 api
 * - 错误提示统一走原型 #toast 样式（服务器错误经 message prop，本地校验错误经 stage.toast）
 */
import { ref } from "vue";
import ImmersiveStage from "./ImmersiveStage.vue";

const props = defineProps<{ message: string }>();
const emit = defineEmits<{ submit: [mode: "login" | "register", username: string, password: string] }>();

const stage = ref<InstanceType<typeof ImmersiveStage> | null>(null);
function toast(msg: string) {
  stage.value?.toast(msg);
}

/* ---- 登录 / 注册 双模式（标题带文字随模式切换） ---- */
const mode = ref<"login" | "register">("login");
const username = ref("");
const password = ref("");
const password2 = ref("");

/* 服务器列表：纯视觉占位，点「更换服务器」循环切换 */
const SERVERS = ["猫隐一区", "猫隐二区", "牧野新区"];
const serverIdx = ref(0);
function switchServer() {
  serverIdx.value = (serverIdx.value + 1) % SERVERS.length;
}

/* 验证码：客户端生成的个位加法算式（演示用） */
const capA = ref(0);
const capB = ref(0);
const capInput = ref("");
function genCap() {
  capA.value = Math.floor(Math.random() * 10);
  capB.value = Math.floor(Math.random() * 10);
  capInput.value = "";
}
genCap();

/* 新闻公告：静态展示数据（照原型） */
const newsList = [
  { title: "【重要公告！】打击第三方代充公告", date: "05/18" },
  { title: "《喵游记》5月15日维护公告", date: "05/14" },
  { title: "《喵游记》4月17日维护公告", date: "04/16" },
  { title: "《喵游记》4月10日维护公告", date: "04/09" },
  { title: "《喵游记》3月21日维护公告", date: "03/20" },
];

/* ---- 登录：原型 doLogin 前置校验（用户名/密码/验证码），通过后交给 App ---- */
function doLogin() {
  const user = username.value.trim();
  if (!user) return toast("请输入用户名");
  if (!password.value) return toast("请输入密码");
  if (parseInt(capInput.value, 10) !== capA.value + capB.value) {
    toast("验证码错误，已刷新");
    genCap();
    return;
  }
  emit("submit", "login", user, password.value);
}

/* ---- 注册（新增）：与服务端校验规则对齐（用户名 2~32、密码 ≥6），确认密码前端拦截 ---- */
function doRegister() {
  const user = username.value.trim();
  if (user.length < 2) return toast("用户名至少 2 个字符");
  if (password.value.length < 6) return toast("密码至少 6 位");
  if (password.value !== password2.value) return toast("两次输入的密码不一致");
  emit("submit", "register", user, password.value);
}
</script>

<template>
  <ImmersiveStage ref="stage" :title="mode === 'login' ? '用户登录' : '注册账号'" :message="message">
    <!-- 登录视图：左表单 + 右公告 -->
    <div v-if="mode === 'login'" class="view">
      <div class="login-grid">
        <div>
          <form @submit.prevent="doLogin">
            <div class="frow">
              <span class="heart">♥</span><label>服务器：</label><b class="srv-name">{{ SERVERS[serverIdx] }}</b><button type="button" class="btn-brown" @click="switchServer">更换服务器</button>
            </div>
            <div class="frow">
              <span class="heart">♥</span><label>用户名：</label><input v-model="username" class="txt" maxlength="32" autocomplete="username" placeholder="冒险者账号" />
            </div>
            <div class="frow">
              <span class="heart">♥</span><label>密码：</label><input v-model="password" class="txt" type="password" maxlength="32" autocomplete="current-password" placeholder="密码" />
            </div>
            <div class="frow">
              <span class="heart">♥</span><label>验证码：</label><input v-model="capInput" class="txt cap-input" maxlength="2" /><span class="cap">{{ capA }} + {{ capB }} = ?</span><a class="link-u" href="#" @click.prevent="genCap">刷新</a>
            </div>
            <button class="btn-login" type="submit">登 录</button>
          </form>
          <div class="btn-row">
            <button class="btn-brown mid" type="button" @click="mode = 'register'">新用户注册</button>
            <button class="btn-brown mid" type="button" @click="toast('找回密码为原型占位')">找回密码</button>
          </div>
          <div class="help">
            <p>- 如您是喵扑通行证用户，<span class="hot" @click="toast('帮助链接为原型占位')">点击此处</span>激活游戏帐号。</p>
            <p>- 无法正常登录的玩家请 <span class="hot" @click="toast('帮助链接为原型占位')">点击此处</span>。</p>
          </div>

          <!-- ④ 新闻公告 -->
          <div class="news">
            <h3>新闻公告</h3>
            <div class="box">
              <div v-for="n in newsList" :key="n.date" class="news-i"><span>{{ n.title }}</span><time>{{ n.date }}</time></div>
            </div>
          </div>
        </div>

        <!-- ⑤ 右侧公告栏 -->
        <div class="rbar">
          <h3>最新活动</h3>
          <div class="card">
            <h4>周年庆典 · 登录有礼</h4>
            <p><span class="heart">♥</span>活动期间每日登录即领豪华大礼包。</p>
            <p><span class="heart">♥</span>新服「猫隐一区」已开放，邀请好友同游猫隐村，赢取限定宠物！</p>
          </div>
          <h3>游戏特色</h3>
          <div class="card">
            <h4>开始你的冒险之旅吧</h4>
            <p><span class="heart">♥</span>17 种宠物 × 战士 / 法师双职业。</p>
            <p><span class="heart">♥</span>经典格子地图，回合对战，重温 2008 页游社区。</p>
            <p><span class="heart">♥</span>装备、技能、任务、公会一应俱全。</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 注册视图（新增；原型无此页，样式沿用原型表单语言） -->
    <div v-else class="view">
      <h2 class="vtitle">注册新账号</h2>
      <form class="reg-form" @submit.prevent="doRegister">
        <div class="frow">
          <span class="heart">♥</span><label>用户名：</label><input v-model="username" class="txt" maxlength="32" autocomplete="username" placeholder="冒险者账号" />
        </div>
        <div class="frow">
          <span class="heart">♥</span><label>密码：</label><input v-model="password" class="txt" type="password" maxlength="32" autocomplete="new-password" placeholder="至少 6 位" />
        </div>
        <div class="frow">
          <span class="heart">♥</span><label>确认密码：</label><input v-model="password2" class="txt" type="password" maxlength="32" autocomplete="new-password" placeholder="再输入一次密码" />
        </div>
        <div class="reg-ops">
          <button class="btn-big gold" type="submit">确认注册</button>
          <button class="btn-big brown" type="button" @click="mode = 'login'">返回登录</button>
        </div>
      </form>
    </div>
  </ImmersiveStage>
</template>

<style scoped>
/* 说明：.view / .vtitle / .btn-big / .txt 为三视图共享原语，统一收在 ImmersiveStage.vue
   的非 scoped 块（.scene 前缀），此处只留本组件差异覆盖。 */

/* ---- 登录视图：左表单 + 右公告 ---- */
.login-grid {
  display: grid;
  grid-template-columns: 420px 1fr;
  gap: 26px;
  height: 100%;
}
.frow {
  margin: 0 0 13px 8px;
  font-size: 14px;
  white-space: nowrap;
}
.frow .heart {
  color: var(--heart);
  font-family: Arial, sans-serif;
  margin-right: 5px;
}
.frow label {
  display: inline-block;
  width: 5em;
}
.txt.cap-input {
  width: 74px;
}
.srv-name {
  color: var(--red-strong);
  font-weight: 700;
  margin: 0 4px 0 2px;
  font-size: 14px;
}
.btn-brown {
  display: inline-block;
  cursor: pointer;
  font: 12px "SimSun", serif;
  color: var(--brown-text);
  padding: 3px 10px;
  border: 1px solid var(--brown-line);
  border-radius: 4px;
  background: linear-gradient(180deg, var(--brown-a), var(--brown-b));
  box-shadow: 0 2px 0 rgba(60, 30, 0, 0.45), inset 0 1px 0 rgba(255, 240, 200, 0.4);
}
.btn-brown:active {
  transform: translateY(1px);
  box-shadow: 0 1px 0 rgba(60, 30, 0, 0.45);
}
.btn-brown.mid {
  padding: 6px 16px;
  font-size: 13px;
  margin-right: 10px;
}
.cap {
  display: inline-block;
  vertical-align: middle;
  width: 96px;
  height: 24px;
  line-height: 22px;
  margin: 0 8px;
  text-align: center;
  font-weight: 700;
  color: var(--cap-ink);
  font-size: 13px;
  background:
    repeating-linear-gradient(28deg, rgba(120, 160, 80, 0.14) 0 3px, transparent 3px 7px),
    repeating-linear-gradient(-35deg, rgba(120, 160, 80, 0.1) 0 2px, transparent 2px 9px),
    var(--cap-bg);
  border: 1px solid #a8c98a;
  border-radius: 3px;
}
.link-u {
  color: var(--link-blue);
  text-decoration: underline;
}
.btn-login {
  display: block;
  width: 154px;
  margin: 16px auto 12px;
  cursor: pointer;
  font-family: "STHupo", "华文琥珀", "SimSun", sans-serif;
  font-size: 23px;
  letter-spacing: 16px;
  text-indent: 16px;
  color: var(--red-word);
  padding: 7px 0 8px;
  border: 2px solid var(--brown-line);
  border-radius: 9px;
  background: linear-gradient(180deg, var(--btn-gold-a), var(--btn-gold-b));
  box-shadow: inset 0 2px 0 #fff6c8, 0 4px 0 #7a4a10, 0 7px 10px rgba(80, 40, 0, 0.35);
}
.btn-login:active {
  transform: translateY(2px);
  box-shadow: inset 0 2px 0 #fff6c8, 0 2px 0 #7a4a10;
}
.btn-row {
  text-align: center;
}
.help {
  margin: 14px 0 0 8px;
  font-size: 12px;
  color: #7a5a20;
}
.help p {
  margin: 3px 0;
}
.hot {
  color: var(--red-strong);
  font-weight: 700;
  cursor: pointer;
}
.hot:hover {
  color: var(--link-blue);
}

/* ---- ④ 新闻公告（登录面板左下） ---- */
.news {
  margin-top: 20px;
}
.news h3 {
  margin: 0 0 8px;
  font-family: "STHupo", "华文琥珀", "SimSun", sans-serif;
  font-size: 21px;
  letter-spacing: 5px;
  color: var(--red-strong);
  text-shadow: 1px 0 0 #ffe98f, -1px 0 0 #ffe98f, 0 1px 0 #ffe98f, 0 -1px 0 #ffe98f, 2px 2px 0 #ffe98f, 0 4px 5px rgba(120, 60, 0, 0.3);
}
.news .box {
  border: 4px solid var(--news-frame);
  border-radius: 12px;
  padding: 7px 9px;
  background: rgba(255, 243, 160, 0.4);
  box-shadow: inset 0 2px 6px rgba(120, 70, 20, 0.25);
}
.news-i {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 30px;
  margin: 5px 0;
  padding: 0 14px;
  cursor: pointer;
  border: 1px solid var(--news-line);
  border-radius: 15px;
  background: linear-gradient(180deg, var(--news-a), var(--news-b));
  color: var(--news-text);
  font-size: 13px;
  transition: filter 0.15s ease;
}
.news-i:hover {
  filter: brightness(1.07) saturate(1.15);
}
.news-i time {
  color: var(--ink-gray);
  font-size: 12px;
}

/* ---- ⑤ 右侧公告栏（糖果条纹标题 + 活动卡） ---- */
.rbar h3 {
  position: relative;
  margin: 0 0 10px;
  font-family: "STHupo", "华文琥珀", "SimSun", sans-serif;
  font-size: 20px;
  letter-spacing: 4px;
  color: #fff6d8;
  text-align: center;
  padding: 6px 0;
  border-radius: 9px;
  background: linear-gradient(180deg, #e84435, #b01f14);
  text-shadow: 0 2px 0 rgba(80, 10, 0, 0.5);
}
.rbar h3::after {
  /* 糖果条纹下缘 */
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -7px;
  height: 7px;
  border-radius: 0 0 8px 8px;
  background: repeating-linear-gradient(45deg, #e85a50 0 9px, var(--cream) 9px 18px);
}
.rbar .card {
  border: 4px solid var(--news-frame);
  border-radius: 12px;
  margin: 14px 0 18px;
  background: linear-gradient(180deg, #fff7c8, #ffe9a0);
  box-shadow: inset 0 2px 6px rgba(120, 70, 20, 0.22);
  padding: 10px 14px;
}
.rbar .card h4 {
  margin: 0 0 6px;
  font-size: 14px;
  color: var(--red-strong);
}
.rbar .card p {
  margin: 3px 0;
  font-size: 12px;
  color: #6b4e1e;
}
.rbar .card .heart {
  color: var(--heart);
  margin-right: 5px;
  font-family: Arial, sans-serif;
}

/* ---- 注册视图（新增） ---- */
.reg-form {
  max-width: 420px;
  margin: 26px auto 0;
}
.reg-ops {
  display: flex;
  justify-content: center;
  gap: 18px;
  margin-top: 26px;
}
</style>

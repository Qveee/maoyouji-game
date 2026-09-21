<script setup lang="ts">
/**
 * 沉浸式舞台：登录 / 选角 / 建角三视图共用的原型复刻框架（prototype/登录页.html）。
 * 职责：青蓝漩涡背景 + 圆点泡泡 + 卷草 + 团子猫 + 右上 LOGO + 木框金板（铆钉 + 圣诞帽猫头标题带）
 *       + toast 提示 + 舞台自适应缩放。
 * 缩放策略：原型 #stage 固定 1452×916，按 min(视口宽/1452, 视口高/916) 等比缩放并居中，
 *           1400×832 基准视口下整屏可见、不出现滚动条。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{ title: string; message?: string }>();

/* ---- 自适应缩放：监听视口尺寸，重算缩放比 ---- */
const DESIGN_W = 1452;
const DESIGN_H = 916;
const scale = ref(1);
function fit() {
  scale.value = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H);
}
onMounted(() => {
  fit();
  window.addEventListener("resize", fit);
});
onBeforeUnmount(() => window.removeEventListener("resize", fit));
const stageStyle = computed(() => ({ transform: `translate(-50%, -50%) scale(${scale.value})` }));

/* ---- toast：样式照原型 #toast。服务器错误经 message prop 变化自动弹出，
       本地前置校验错误由父级经 expose 的 toast() 弹出 ---- */
const toastOn = ref(false);
const toastText = ref("");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string) {
  toastText.value = msg;
  toastOn.value = true;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastOn.value = false), 2200);
}
watch(
  () => props.message,
  (m) => {
    if (m) toast(m);
  },
);
defineExpose({ toast });
</script>

<template>
  <div class="scene">
    <div class="stage" :style="stageStyle">
      <!-- ① 背景层：大漩涡 + 圆点泡泡 -->
      <div class="swirl s1"></div>
      <div class="swirl s2"></div>
      <div class="bub b1"></div>
      <div class="bub b2"></div>
      <div class="bub b3"></div>
      <div class="bub b4"></div>
      <div class="bub b5"></div>
      <div class="bub b6"></div>
      <div class="bub b7"></div>
      <div class="bub b8"></div>

      <!-- ⑥ 装饰：奶白藤蔓卷草花 + 团子猫 -->
      <div class="vine v1"><i></i><i></i><i></i><i></i></div>
      <div class="vine v2"><i></i><i></i><i></i><i></i></div>
      <div class="vine v3"><i></i><i></i><i></i><i></i></div>
      <div class="vine v4"><i></i><i></i><i></i><i></i></div>
      <div class="vine v5"><i></i><i></i><i></i><i></i></div>
      <div class="dcat d1"><b class="ear l"></b><b class="ear r"></b><i class="face"></i><span class="eye l"></span><span class="eye r"></span><span class="blush l"></span><span class="blush r"></span></div>
      <div class="dcat d2"><b class="ear l"></b><b class="ear r"></b><i class="face"></i><span class="eye l"></span><span class="eye r"></span><span class="blush l"></span><span class="blush r"></span></div>
      <div class="dcat d3"><b class="ear l"></b><b class="ear r"></b><i class="face"></i><span class="eye l"></span><span class="eye r"></span><span class="blush l"></span><span class="blush r"></span></div>
      <div class="dcat d4"><b class="ear l"></b><b class="ear r"></b><i class="face"></i><span class="eye l"></span><span class="eye r"></span><span class="blush l"></span><span class="blush r"></span></div>
      <div class="dcat d5"><b class="ear l"></b><b class="ear r"></b><i class="face"></i><span class="eye l"></span><span class="eye r"></span><span class="blush l"></span><span class="blush r"></span></div>

      <!-- ② LOGO 区（右上角） -->
      <div class="logo">
        <h1 class="logo-word" data-text="喵游记">喵游记</h1>
        <div class="logo-slogan">随时随地…的快乐</div>
        <div class="logo-domain">PET.MAOMIAO.COM（站点域名占位）</div>
      </div>

      <!-- ③ 中央木框金板：铆钉 + 标题带 + 视图内容（插槽） -->
      <div class="panel">
        <span class="rv k1"></span><span class="rv k2"></span><span class="rv k3"></span><span class="rv k4"></span>
        <span class="rv m1"></span><span class="rv m2"></span><span class="rv m3"></span><span class="rv m4"></span>
        <div class="ptitle">
          <span class="santa"><i class="head"></i><i class="hat"></i><i class="brim"></i><i class="pom"></i><span class="ear l"></span><span class="ear r"></span><span class="eye l"></span><span class="eye r"></span></span>
          <span class="ptitle-text">{{ title }}</span>
        </div>
        <slot />
      </div>
    </div>

    <!-- 提示条（原型 #toast）：置于缩放舞台之外，保持视口居中与原始字号 -->
    <div v-show="toastOn" class="toast" role="alert">{{ toastText }}</div>
  </div>
</template>

<style scoped>
/* 主题变量（照搬原型 :root，挂在 .scene 上供三视图继承） */
.scene {
  --bg-main: #2fbfd8;
  --bg-dark: #1fa6c0;
  --wood-dark: #6b3e1b;
  --wood-light: #c98a3e;
  --gold-1: #fff3a0;
  --gold-2: #ffdf6e;
  --gold-3: #f8c33c;
  --btn-gold-a: #ffe98f;
  --btn-gold-b: #f5b93b;
  --brown-a: #b97a32;
  --brown-b: #8a5218;
  --brown-line: #5c3310;
  --brown-text: #ffe9b0;
  --red-strong: #d63a2a;
  --red-word: #d42a1e;
  --heart: #ff8fae;
  --news-a: #fbe49b;
  --news-b: #edbe55;
  --news-line: #a87718;
  --news-text: #5c3a10;
  --news-frame: #5e2b14;
  --cream: #fff6d8;
  --cap-bg: #dff5c8;
  --cap-ink: #3e6b2a;
  --ink-navy: #14506e;
  --link-blue: #1e7fb8;
  --ink-brown: #5c3a10;
  --ink-gray: #8b7b55;

  position: fixed;
  inset: 0;
  overflow: hidden;
  font: 12px/1.7 "SimSun", "宋体", serif;
  color: var(--ink-brown);
  /* ① 背景：满屏青蓝渐变（主色 #2FBFD8，四角略深 #1FA6C0） */
  background:
    radial-gradient(640px 640px at 0% 0%, var(--bg-dark) 0%, transparent 72%),
    radial-gradient(640px 640px at 100% 0%, var(--bg-dark) 0%, transparent 72%),
    radial-gradient(720px 720px at 0% 100%, var(--bg-dark) 0%, transparent 72%),
    radial-gradient(720px 720px at 100% 100%, var(--bg-dark) 0%, transparent 72%),
    var(--bg-main);
}

/* 原型 #stage：固定 1452×916，整体等比缩放居中（transform 由 :style 注入） */
.stage {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 1452px;
  height: 916px;
}

/* 大漩涡（更浅的青白旋臂） */
.swirl {
  position: absolute;
  border-radius: 50%;
  filter: blur(5px);
  opacity: 0.7;
  pointer-events: none;
}
.swirl.s1 {
  left: -140px;
  top: -120px;
  width: 520px;
  height: 520px;
  background: conic-gradient(
    from 40deg,
    rgba(255, 255, 255, 0.22),
    transparent 22%,
    rgba(255, 255, 255, 0.22) 48%,
    transparent 70%,
    rgba(255, 255, 255, 0.22) 90%,
    transparent
  );
}
.swirl.s2 {
  right: -160px;
  bottom: -180px;
  width: 640px;
  height: 640px;
  background: conic-gradient(
    from 210deg,
    rgba(255, 255, 255, 0.18),
    transparent 25%,
    rgba(255, 255, 255, 0.18) 52%,
    transparent 76%,
    rgba(255, 255, 255, 0.18)
  );
}

/* 圆点泡泡 */
.bub {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  background: radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0.18) 55%, transparent 75%);
}
.bub.b1 { left: 180px; top: 130px; width: 36px; height: 36px; }
.bub.b2 { left: 320px; bottom: 210px; width: 22px; height: 22px; }
.bub.b3 { right: 260px; top: 200px; width: 30px; height: 30px; }
.bub.b4 { right: 150px; bottom: 150px; width: 48px; height: 48px; }
.bub.b5 { left: 640px; top: 70px; width: 18px; height: 18px; }
.bub.b6 { left: 120px; top: 520px; width: 26px; height: 26px; }
.bub.b7 { right: 520px; bottom: 90px; width: 20px; height: 20px; }
.bub.b8 { right: 80px; top: 430px; width: 26px; height: 26px; }

/* ② LOGO 区（右上角） */
.logo {
  position: absolute;
  top: 30px;
  right: 64px;
  text-align: right;
  transform: rotate(-3deg);
  z-index: 5;
}
.logo-word {
  position: relative;
  margin: 0;
  font-size: 96px;
  line-height: 1.05;
  letter-spacing: 8px;
  font-family: "STHupo", "华文琥珀", "FZCuHei", "方正粗圆_GBK", "SimSun", sans-serif;
  color: transparent;
  text-shadow:
    4px 0 0 var(--brown-b),
    -4px 0 0 var(--brown-b),
    0 4px 0 var(--brown-b),
    0 -4px 0 var(--brown-b),
    5px 5px 0 var(--brown-b),
    -5px 5px 0 var(--brown-b),
    5px -5px 0 var(--brown-b),
    -5px -5px 0 var(--brown-b),
    0 10px 14px rgba(60, 35, 0, 0.5);
}
.logo-word::before {
  content: attr(data-text);
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, #fff3c0 8%, #ffc63e 52%, #e8821a 92%);
  -webkit-background-clip: text;
  background-clip: text;
}
.logo-word::after {
  /* 白色顶部高光 */
  content: attr(data-text);
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92) 4%, rgba(255, 255, 255, 0) 34%);
  -webkit-background-clip: text;
  background-clip: text;
}
.logo-slogan {
  margin: 2px 6px 0 0;
  font-family: "STHupo", "华文琥珀", "SimSun", sans-serif;
  font-size: 22px;
  letter-spacing: 4px;
  color: #ffe27a;
  text-shadow: 2px 2px 0 #8a5218, -1px -1px 0 #8a5218, 1px -1px 0 #8a5218, -1px 1px 0 #8a5218, 0 4px 6px rgba(60, 35, 0, 0.45);
}
.logo-domain {
  margin: 6px 8px 0 0;
  font-size: 13px;
  letter-spacing: 2px;
  color: #eaf7fc;
  text-shadow: 0 1px 2px rgba(10, 60, 80, 0.5);
}

/* ③ 中央登录面板（木框 + 金底 + 铆钉） */
.panel {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -52%);
  width: 930px;
  height: 670px;
  padding: 46px 40px 30px;
  border: 12px solid var(--wood-dark);
  border-radius: 26px;
  background: linear-gradient(180deg, var(--gold-1) 0%, var(--gold-2) 55%, var(--gold-3) 100%);
  box-shadow:
    inset 0 0 0 3px var(--wood-light),
    inset 0 0 70px rgba(160, 100, 20, 0.28),
    0 26px 60px rgba(8, 58, 78, 0.5);
}
.panel::before {
  /* 木纹 */
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 14px;
  pointer-events: none;
  background: repeating-linear-gradient(
    94deg,
    rgba(150, 92, 26, 0.07) 0 22px,
    rgba(110, 64, 18, 0.05) 22px 24px,
    transparent 24px 66px
  );
}
/* 金色球形铆钉：四角 + 四边中点 */
.rv {
  position: absolute;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  z-index: 3;
  background: radial-gradient(circle at 32% 28%, #fffdf0, #ffe27a 36%, #e8a93c 62%, #8a5218 100%);
  box-shadow: 0 2px 3px rgba(50, 25, 0, 0.5), inset 0 -2px 3px rgba(90, 40, 0, 0.45);
}
.rv.k1 { left: -16px; top: -16px; }
.rv.k2 { right: -16px; top: -16px; }
.rv.k3 { left: -16px; bottom: -16px; }
.rv.k4 { right: -16px; bottom: -16px; }
.rv.m1 { left: 50%; margin-left: -11px; top: -16px; }
.rv.m2 { left: 50%; margin-left: -11px; bottom: -16px; }
.rv.m3 { top: 50%; margin-top: -11px; left: -16px; }
.rv.m4 { top: 50%; margin-top: -11px; right: -16px; }

/* 「用户登录」标题带 + 圣诞帽猫头 */
.ptitle {
  position: absolute;
  left: 36px;
  top: -26px;
  width: 300px;
  height: 54px;
  z-index: 4;
  border: 3px solid var(--brown-line);
  border-radius: 27px;
  background: linear-gradient(180deg, #ffe98f, #f0b23c);
  box-shadow: 0 5px 10px rgba(80, 40, 0, 0.4), inset 0 2px 0 #fff6d0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: "STHupo", "华文琥珀", "SimSun", sans-serif;
  font-size: 26px;
  letter-spacing: 10px;
  text-indent: 10px;
  color: #9a5a10;
  text-shadow: 0 1px 0 #fff3c0, 0 -1px 0 #7a4a10, 0 3px 4px rgba(90, 50, 0, 0.4);
}
.santa {
  position: absolute;
  left: -30px;
  top: -4px;
  width: 52px;
  height: 46px;
}
.santa .head {
  position: absolute;
  left: 6px;
  top: 8px;
  width: 40px;
  height: 36px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fff, #f2ecdf 75%);
  border: 2px solid #d9cba8;
}
.santa .ear {
  position: absolute;
  width: 7px;
  height: 7px;
  background: #ffc9d4;
  border-radius: 50%;
  top: 26px;
}
.santa .ear.l { left: 12px; }
.santa .ear.r { right: 12px; }
.santa .eye {
  position: absolute;
  width: 4px;
  height: 6px;
  background: #4a3a28;
  border-radius: 50%;
  top: 19px;
}
.santa .eye.l { left: 17px; }
.santa .eye.r { right: 17px; }
.santa .hat {
  position: absolute;
  left: 1px;
  top: -12px;
  width: 44px;
  height: 30px;
  background: linear-gradient(180deg, #e84435, #b01f14);
  clip-path: polygon(0 100%, 46% 0, 100% 100%);
  filter: drop-shadow(0 1px 1px rgba(60, 10, 0, 0.4));
}
.santa .brim {
  position: absolute;
  left: 0;
  top: 14px;
  width: 48px;
  height: 9px;
  border-radius: 5px;
  background: linear-gradient(180deg, #fff, #e9e2d2);
  border: 1px solid #d9cba8;
}
.santa .pom {
  position: absolute;
  left: 16px;
  top: -16px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fff, #efe8d8);
}

/* ⑥ 装饰：奶白藤蔓卷草花（四角 + 底边） */
.vine {
  position: absolute;
  width: 130px;
  height: 130px;
  pointer-events: none;
  opacity: 0.9;
}
.vine i {
  position: absolute;
  border: 7px solid var(--cream);
  border-radius: 50%;
  opacity: 0.55;
}
.vine i:nth-child(1) { width: 54px; height: 54px; left: 8px; top: 36px; }
.vine i:nth-child(2) { width: 38px; height: 38px; left: 58px; top: 10px; opacity: 0.4; }
.vine i:nth-child(3) { width: 30px; height: 30px; left: 64px; top: 66px; opacity: 0.45; }
.vine i:nth-child(4) { width: 16px; height: 16px; left: 44px; top: 22px; opacity: 0.35; }
.vine::before {
  content: "";
  position: absolute;
  left: 6px;
  top: 58px;
  width: 96px;
  height: 9px;
  border-radius: 6px;
  background: var(--cream);
  opacity: 0.4;
  transform: rotate(-16deg);
}
.vine::after {
  content: "";
  position: absolute;
  left: 30px;
  top: 50px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: radial-gradient(circle, transparent 40%, var(--cream) 42%, var(--cream) 60%, transparent 62%);
  opacity: 0.5;
}
.vine.v1 { left: 36px; top: 26px; }
.vine.v2 { right: 30px; top: 96px; transform: scaleX(-1) rotate(14deg); }
.vine.v3 { left: 56px; bottom: 36px; transform: rotate(22deg) scale(0.9); }
.vine.v4 { right: 60px; bottom: 26px; transform: scaleX(-1); }
.vine.v5 { left: 48%; bottom: 16px; transform: scale(0.8); }

/* 团子猫：白色椭圆身体 + 三角耳 + 粉腮红 + 简笔表情 */
.dcat {
  position: absolute;
  width: 100px;
  height: 82px;
  pointer-events: none;
}
.dcat .face {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 28%, #fff, #f6f0e3 72%, #eadfc9);
  border: 2px solid #d9cba8;
  box-shadow: 0 6px 10px rgba(10, 70, 95, 0.25);
}
.dcat .ear {
  position: absolute;
  top: -15px;
  width: 0;
  height: 0;
  border: 13px solid transparent;
  border-bottom: 21px solid #fbf7ec;
}
.dcat .ear::after {
  content: "";
  position: absolute;
  left: -6px;
  top: 8px;
  width: 0;
  height: 0;
  border: 6px solid transparent;
  border-bottom: 10px solid #f3c9cf;
}
.dcat .ear.l { left: 13px; transform: rotate(-16deg); }
.dcat .ear.r { right: 13px; transform: rotate(16deg); }
.dcat .eye {
  position: absolute;
  top: 30px;
  width: 6px;
  height: 9px;
  background: #4a3a28;
  border-radius: 50%;
}
.dcat .eye.l { left: 24px; }
.dcat .eye.r { right: 24px; }
.dcat .blush {
  position: absolute;
  top: 42px;
  width: 12px;
  height: 7px;
  background: #ffc9d4;
  border-radius: 50%;
  opacity: 0.85;
}
.dcat .blush.l { left: 12px; }
.dcat .blush.r { right: 12px; }
.dcat.d1 { left: 150px; bottom: 88px; transform: rotate(-8deg); }
.dcat.d2 { left: 250px; bottom: 40px; transform: scale(0.7) rotate(6deg); }
.dcat.d3 { right: 190px; bottom: 64px; transform: scale(0.85) scaleX(-1) rotate(-4deg); }
.dcat.d4 { right: 96px; bottom: 150px; transform: scale(0.6); }
.dcat.d5 { left: 60px; top: 300px; transform: scale(0.62) rotate(12deg); }

/* 提示条（原型 #toast） */
.toast {
  position: fixed;
  left: 50%;
  top: 16px;
  transform: translateX(-50%);
  z-index: 99;
  padding: 8px 22px;
  font-size: 14px;
  color: #fff3c0;
  background: linear-gradient(180deg, #b01f14, #7a130a);
  border: 2px solid #ffe9b0;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
}
</style>

<style>
/* ============================================================
   三视图共享样式原语（非 scoped，统一以 .scene 作祖先前缀限定作用域，
   不外溢到 GameShell 的 btn3d 体系；组件内只保留差异覆盖）
   ============================================================ */
/* 视图容器：占满金板内区，压住木纹伪元素 */
.scene .view {
  position: relative;
  z-index: 2;
  height: 100%;
}

/* 视图大标题（选角「请选择角色」/ 注册「注册新账号」） */
.scene .vtitle {
  margin: 4px 0 18px;
  text-align: center;
  font-family: "STHupo", "华文琥珀", "SimSun", sans-serif;
  font-size: 30px;
  letter-spacing: 8px;
  color: var(--red-strong);
  text-shadow: 2px 0 0 #ffe98f, -2px 0 0 #ffe98f, 0 2px 0 #ffe98f, 0 -2px 0 #ffe98f, 3px 3px 0 #ffe98f,
    0 5px 6px rgba(120, 60, 0, 0.32);
}

/* 输入框基类（白底 / 边框 / inset 阴影 / 宋体 12px） */
.scene .txt {
  width: 182px;
  padding: 3px 7px;
  font: 12px "SimSun", serif;
  background: #fff;
  border: 1px solid #b9b9b9;
  box-shadow: inset 1px 1px 3px rgba(0, 0, 0, 0.14);
  border-radius: 2px;
}
.scene .txt:focus {
  outline: none;
  border-color: var(--link-blue);
}

/* 大按钮（开始游戏/创建角色/删除角色/退出登录/确认注册/返回登录） */
.scene .btn-big {
  cursor: pointer;
  font-family: "STHupo", "华文琥珀", "SimSun", sans-serif;
  font-size: 19px;
  letter-spacing: 6px;
  text-indent: 6px;
  padding: 8px 26px;
  border-radius: 9px;
  border: 2px solid var(--brown-line);
}
.scene .btn-big.gold {
  color: var(--red-word);
  background: linear-gradient(180deg, var(--btn-gold-a), var(--btn-gold-b));
  box-shadow: inset 0 2px 0 #fff6c8, 0 4px 0 #7a4a10, 0 7px 10px rgba(80, 40, 0, 0.35);
}
.scene .btn-big.brown {
  color: var(--brown-text);
  background: linear-gradient(180deg, var(--brown-a), var(--brown-b));
  box-shadow: inset 0 1px 0 rgba(255, 240, 200, 0.4), 0 4px 0 #3e2208, 0 7px 10px rgba(50, 25, 0, 0.35);
}
.scene .btn-big.red {
  color: #ffe9b0;
  background: linear-gradient(180deg, #c94a3a, #8f2114);
  border-color: #5e130a;
  box-shadow: inset 0 1px 0 rgba(255, 220, 200, 0.35), 0 4px 0 #4a0f06, 0 7px 10px rgba(50, 10, 0, 0.35);
}
.scene .btn-big:active {
  transform: translateY(2px);
}
</style>

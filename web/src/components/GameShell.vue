<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { api, type MapNode } from "../api";

const props = defineProps<{
  username: string;
  characterName: string;
  petGif: string;
}>();

defineEmits<{ switchView: [] }>();

const GW = 800;
const GH = 600;
const ZOOM = 1.8; // 视野拉远：可见范围约为全图 55.6%（与原型一致）
const camX = ref(0);
const camY = ref(0);

const map = ref<Awaited<ReturnType<typeof api.mapCurrent>> | null>(null);
const fitScale = ref(1);
const messages = ref<{ time: string; text: string; kind: "sys" | "chat" }[]>([]);
const chatText = ref("");
const channel = ref("区域");
const busy = ref(false);

const currentNode = computed<MapNode | null>(
  () => map.value?.nodes.find((n) => n.code === map.value?.currentNodeCode) ?? null,
);

/** 镜头：让玩家居中，clamp 在世界边界内（百分比 translate 基于 mapview 自身尺寸） */
const camTransform = computed(() => {
  if (!currentNode.value) return "translate(0,0)";
  const vw = GW / ZOOM;
  const vh = GH / ZOOM;
  const cx = Math.max(0, Math.min(currentNode.value.x - vw / 2, GW - vw));
  const cy = Math.max(0, Math.min(currentNode.value.y - vh / 2, GH - vh));
  return `translate(${-(cx / GW) * 100}%, ${-(cy / GH) * 100}%)`;
});

const posStyle = (x: number, y: number) => ({ left: (x / GW) * 100 + "%", top: (y / GH) * 100 + "%" });

function now() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function say(text: string, kind: "sys" | "chat" = "sys") {
  messages.value.push({ time: now(), text, kind });
  if (messages.value.length > 60) messages.value.shift();
}

async function load() {
  map.value = await api.mapCurrent();
}

async function move(node: MapNode) {
  if (busy.value || node.code === map.value?.currentNodeCode) return;
  if (node.locked) {
    say(`【系统】${node.lockedReason ?? "该地点暂未开放"}`);
    return;
  }
  busy.value = true;
  try {
    await api.move(node.code);
    map.value!.currentNodeCode = node.code;
  } catch (err) {
    say(`【系统】${err instanceof Error ? err.message : "移动失败"}`);
  } finally {
    busy.value = false;
  }
}

function sendChat() {
  const text = chatText.value.trim();
  if (!text) return;
  say(`${props.characterName}：${text}`, "chat");
  chatText.value = "";
}

function todo(what: string) {
  say(`【系统】${what}将在后续切片开放。`);
}

/** 舞台等比缩放：窗口小于 1400×832 时整体缩小，避免截断与横向滚动 */
function fitStage() {
  fitScale.value = Math.max(0.4, Math.min(window.innerWidth / 1424, (window.innerHeight - 28) / 848, 1));
}

const topMenus = ["功能", "帮助", "图鉴", "战斗力", "竞技场", "成就", "活动"];
const funcBtns = ["任务", "技能", "道具", "宝库", "宠物", "好友", "队伍", "公会"];
const SLOT_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 10, 11, 12];

onMounted(async () => {
  fitStage();
  window.addEventListener("resize", fitStage);
  await load();
  say(`欢迎来到猫隐村，${props.characterName}！点击地图上的地点即可移动。`);
});

onUnmounted(() => window.removeEventListener("resize", fitStage));
</script>

<template>
  <div class="stage-fit" :style="{ '--fit-scale': String(fitScale) }">
  <main class="shell">
    <!-- 顶栏 28px -->
    <header class="topnav">
      <nav>
        <a v-for="m in topMenus" :key="m" href="#" @click.prevent="todo(m)">{{ m }}</a>
      </nav>
      <div class="promo"><i>《喵游记》周年庆典火热开启！登录即领豪华大礼包；新服「猫隐一区」已开放，邀请好友同游猫隐村，赢取限定宠物！</i></div>
      <div class="server">负荷：<b>畅通</b> <span class="uname">{{ username }}</span>
        <a href="#" @click.prevent="$emit('switchView')">切换角色</a>
      </div>
    </header>

    <div class="main">
      <!-- 左：地图 + 聊天记录 -->
      <section class="left">
        <div class="scene">
          <div class="mapview">
            <div
              v-if="map"
              class="world"
              :style="{ transform: camTransform, background: `url('${map.map.background}') center / 100% 100% no-repeat` }"
            >
            <template v-if="map">
              <button
                v-for="n in map.nodes"
                :key="n.code"
                class="loc"
                :class="{ current: n.code === map.currentNodeCode, locked: n.locked }"
                :style="posStyle(n.x, n.y)"
                :title="n.name"
                @click="move(n)"
              >
                {{ n.short }}
              </button>
              <div
                v-if="currentNode"
                class="pet-mark"
                :style="posStyle(currentNode.x, currentNode.y)"
              >
                <img :src="petGif" :alt="characterName" />
              </div>
            </template>
            </div>
          </div>
        </div>
        <div class="chatlog panel">
          <div class="panel-head">聊天记录</div>
          <div class="body scr">
            <p v-for="(m, i) in messages" :key="i" :class="m.kind">
              <time>{{ m.time }}</time> {{ m.text }}
            </p>
          </div>
        </div>
      </section>

      <!-- 中：NPC / 玩家 -->
      <section class="center">
        <div class="panel npc-panel">
          <div class="panel-head">{{ currentNode ? currentNode.name : "—" }}</div>
          <div class="body scr">
            <p v-if="!currentNode?.npcs.length" class="empty">这里空荡荡的，没有 NPC。</p>
            <div
              v-for="npc in currentNode?.npcs"
              :key="npc.name"
              class="npc"
              @click="say(`【系统】与【${npc.name}】的交互将在任务切片开放。`)"
            >
              <span v-if="npc.title" class="tt" :class="'t-' + (npc.titleColor || '')">{{ npc.title }}</span>
              <b :title="'交谈'">{{ npc.name }}</b>
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="M1 2h10v7H7l-3 3v-3H1z" fill="#e8f4fc" stroke="#2f7fc4" stroke-width="1.2" />
                <circle cx="4" cy="5.2" r=".8" fill="#2f7fc4" />
                <circle cx="6" cy="5.2" r=".8" fill="#2f7fc4" />
                <circle cx="8" cy="5.2" r=".8" fill="#2f7fc4" />
              </svg>
            </div>
          </div>
        </div>
        <div class="panel players-panel">
          <div class="body scr"></div>
        </div>
      </section>

      <!-- 右：消息窗 + 输入 -->
      <section class="right">
        <div class="panel drop-panel">
          <div class="panel-head">世界·掉落公告</div>
          <div class="body scr"><p class="empty">暂无公告。</p></div>
        </div>
        <div class="panel private-panel">
          <div class="panel-head">私人信息</div>
          <div class="body scr"><p class="empty">暂无私信。</p></div>
        </div>
        <div class="panel input-panel">
          <select v-model="channel">
            <option>区域</option><option>世界</option><option>私聊</option><option>公会</option>
          </select>
          <input v-model="chatText" maxlength="60" placeholder="在这里输入聊天内容…" @keydown.enter.prevent="sendChat" />
          <button type="button" @click="sendChat">输入</button>
        </div>
      </section>
    </div>

    <!-- 底栏 80px -->
    <footer class="bottombar">
      <div class="bar-main">
        <div class="skillzone" @click.self="todo('技能书')">
          <img src="/ui/skillbar.png" alt="技能栏" draggable="false" />
          <div class="slots">
            <div
              v-for="(k, i) in SLOT_KEYS"
              :key="i"
              class="slot"
              :title="`技能格${i + 1}（快捷键 ${k}，未装备，点击打开技能书）`"
              @click="todo('技能书')"
            ></div>
          </div>
          <div class="pagebtns" title="技能栏翻页">
            <i data-p="up"></i><i data-p="down"></i>
          </div>
        </div>
        <div class="fbtns">
          <div v-for="f in funcBtns" :key="f" class="fbtn" :title="f" @click="todo(f)">
            <img :src="`/ui/${f}按钮.gif`" :alt="f" />
          </div>
        </div>
      </div>
    </footer>
  </main>
  </div>
</template>

<style scoped>
.stage-fit {
  display: flex;
  justify-content: center;
  height: calc((832px + 24px) * var(--fit-scale, 1));
  overflow: hidden;
}
.shell {
  width: 1400px;
  height: 832px;
  margin: 12px auto;
  display: flex;
  flex-direction: column;
  background: #9fd0e6;
  border: 2px solid #14506e;
  font: 12px/1.6 "SimSun", "宋体", serif;
  color: #14506e;
  transform: scale(var(--fit-scale, 1));
  transform-origin: top center;
}

/* 顶栏 */
.topnav {
  height: 28px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 10px;
  background: linear-gradient(#d9f0fa, #b7dcee);
  border-bottom: 1px solid #58b1d8;
}
.topnav nav { display: flex; gap: 10px; }
.topnav a { color: #1e7fb8; }
.promo { flex: 1; overflow: hidden; white-space: nowrap; color: #48788f; }
.server { color: #48788f; }
.server .uname { color: #14506e; font-weight: 700; margin: 0 6px; }

/* 主区 */
.main { flex: 1; display: flex; gap: 4px; padding: 4px; min-height: 0; }
.left { width: 600px; display: flex; flex-direction: column; gap: 4px; min-height: 0; }
.scene { flex: none; aspect-ratio: 4 / 3; background: #cde9f5; border: 1px solid #58b1d8; overflow: hidden; }
.mapview { position: relative; width: 100%; height: 100%; overflow: hidden; background: #7fae62; box-shadow: inset 0 0 20px rgba(30, 60, 80, 0.35); }
.world { position: absolute; left: 0; top: 0; width: 180%; height: 180%; background: #7fae62; }
.loc {
  position: absolute;
  transform: translate(-50%, -50%);
  cursor: pointer;
  z-index: 1;
  padding: 0 3px;
  font: bold 12px/14px "SimSun", "宋体", serif;
  white-space: nowrap;
  color: #4b4b42;
  background: #ffffe1;
  border: 1px solid rgba(13, 62, 90, 0.45);
  box-shadow: 0 1px 2px rgba(20, 40, 60, 0.25);
  white-space: nowrap;
  transition: background-color 0.15s ease;
}
.loc:hover { background: #fffdf0; border-color: #3a8ec2; }
.loc.current { color: #fff; background: #338ee1; border-color: #38b6f0; font-weight: bold; box-shadow: 0 0 0 2px rgba(56, 182, 240, 0.5); }
.loc.locked { color: #8b7b55; border-style: dashed; }
.pet-mark {
  position: absolute;
  z-index: 3;
  pointer-events: none;
  transform: translate(-50%, -50%);
  filter: drop-shadow(0 2px 2px rgba(0, 20, 40, 0.5));
  animation: bob 1.2s ease-in-out infinite;
}
.pet-mark img { height: 60px; width: auto; display: block; }
@keyframes bob { 50% { transform: translate(-50%, calc(-50% - 3px)); } }
@media (prefers-reduced-motion: reduce) { .pet-mark { animation: none; } }

/* 面板通用 */
.panel {
  background: linear-gradient(#cde9f5, #aed7ea);
  border: 1px solid #58b1d8;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.panel-head {
  flex: none;
  padding: 2px 8px;
  font-weight: 700;
  background: #b7dcee;
  border-bottom: 1px solid #58b1d8;
}
.body { flex: 1; overflow-y: auto; padding: 4px 8px; }
.body.scr::-webkit-scrollbar { width: 8px; }
.body.scr::-webkit-scrollbar-thumb { background: #8db8cd; border-radius: 4px; }
.empty { color: #8b7b55; }

.chatlog { flex: 1; min-height: 0; }
.chatlog time { color: #8b7b55; margin-right: 4px; }
.chatlog p {
  margin: 1px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chatlog p.chat { color: #1e5f3f; }

.center { width: 290px; display: flex; flex-direction: column; gap: 4px; min-height: 0; }
.npc-panel { flex: 3; }
.npc-panel .panel-head { text-align: center; color: #000; font-weight: bold; }
.players-panel { flex: 2; }
.npc { display: flex; align-items: center; gap: 4px; line-height: 20px; white-space: nowrap; overflow: hidden; cursor: pointer; }
.npc:hover { background: #d9eef8; }
.npc b { color: #14506e; font-weight: bold; }
.npc b:hover { color: #0d6ba8; }
.npc svg { width: 12px; height: 12px; flex: none; }
.npc .tt { flex: none; font-weight: 400; }
.npc .tt.t-red { color: #c33812; }
.npc .tt.t-blue { color: #2b6fc4; }
.npc .tt.t-green { color: #178714; }
.npc .tt.t-orange { color: #d97a00; }

.right { flex: 1; min-width: 300px; display: flex; flex-direction: column; gap: 4px; min-height: 0; }
.drop-panel { flex: 2; }
.private-panel { flex: 2; }
.input-panel { flex: none; height: 38px; display: flex; align-items: center; gap: 5px; padding: 0 6px; }
.input-panel select {
  width: 62px; height: 24px; color: #1a1a1a; background: #fff; cursor: pointer;
  border: 1px solid #7f7f7f; box-shadow: inset 1px 1px 0 #d4d0c8;
}
.input-panel input {
  flex: 1; min-width: 0; height: 24px; padding: 0 6px; color: #111; background: #fff;
  border: 1px solid #7f7f7f; box-shadow: inset 1px 1px 0 #d4d0c8; outline: none;
}
.input-panel input:focus { border-color: #3a8ec2; }
.input-panel button {
  width: 56px; height: 26px; cursor: pointer; font: bold 12px "SimSun", serif; color: #fff;
  text-shadow: 0 1px 1px #6b3407;
  background: linear-gradient(#f4bc6a, #d3812f 55%, #b96a1d);
  border: 1px solid #7a3d0d;
  box-shadow: inset 1px 1px 0 #ffd9a3, 1px 1px 2px rgba(60, 30, 0, 0.35);
}
.input-panel button:hover { filter: brightness(1.08); }

/* 底栏 */
.bottombar {
  height: 78px;
  flex: none;
  background-image: url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20width%3D%27380%27%20height%3D%2778%27%3E%3Cg%20fill%3D%27none%27%20stroke%3D%27%236fc4e4%27%20stroke-opacity%3D%27.40%27%20stroke-width%3D%273%27%20stroke-linecap%3D%27round%27%3E%3Cpath%20d%3D%27M64%2066c-24-8-33-32-17-49%2013-14%2036-11%2044%204%206%2013-3%2026-16%2025-10-1-15-9-10-17%27%2F%3E%3Ccircle%20cx%3D%27158%27%20cy%3D%2728%27%20r%3D%2715%27%2F%3E%3Cpath%20d%3D%27M158%205c15%201%2027%2011%2028%2025%27%2F%3E%3Cpath%20d%3D%27M262%2072c-17-5-25-22-16-36%208-13%2026-14%2034-3%207%2010%201%2023-11%2022%27%2F%3E%3C%2Fg%3E%3Cg%20fill%3D%27none%27%20stroke%3D%27%232f8cb4%27%20stroke-opacity%3D%27.25%27%20stroke-width%3D%273%27%20stroke-linecap%3D%27round%27%3E%3Cpath%20d%3D%27M22%2022c11-9%2026-6%2032%205%27%2F%3E%3Ccircle%20cx%3D%27216%27%20cy%3D%2756%27%20r%3D%2712%27%2F%3E%3Cpath%20d%3D%27M316%2026c13-11%2030-6%2036%207%27%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E"),linear-gradient(180deg,#48a1c8 0%,#449ec5 30%,#439dc4 45%,#45a0c7 62%,#409ac1 100%);
  background-size: 380px 76px, auto;
  background-position: -50px 0, 0 0;
  border-top: 1px solid #2e86ab;
}
.bar-main { flex: 1; display: flex; align-items: center; min-width: 0; padding-right: 24px; }
.skillzone { position: relative; flex: none; height: 100%; width: 742px; cursor: pointer; }
.skillzone > img { width: 100%; height: 100%; display: block; }
.slots { position: absolute; left: 20px; top: 10px; width: 632px; height: 44px; display: flex; gap: 5px; }
.slot { width: 44px; flex: none; cursor: pointer; }
.slot:hover { box-shadow: inset 0 0 0 2px rgba(255, 240, 170, 0.65); }
.pagebtns { position: absolute; left: 653px; top: 7px; width: 47px; height: 46px; cursor: pointer; }
.pagebtns i { position: absolute; left: 0; width: 100%; height: 50%; }
.pagebtns i:hover { background: rgba(255, 255, 255, 0.22); }
.fbtns { flex: 1; display: flex; justify-content: space-evenly; align-items: center; min-width: 0; }
.fbtn { cursor: pointer; line-height: 0; }
.fbtn img { width: 60px; height: 60px; }
.fbtn:hover { filter: brightness(1.13); }
</style>

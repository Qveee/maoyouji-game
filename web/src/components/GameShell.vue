<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, type MapNode } from "../api";

const props = defineProps<{
  username: string;
  characterName: string;
  petGif: string;
}>();

defineEmits<{ switchView: [] }>();

const MAP_SCALE = 0.75; // 背景图 800×600 → 显示 600×450

const map = ref<Awaited<ReturnType<typeof api.mapCurrent>> | null>(null);
const messages = ref<{ time: string; text: string; kind: "sys" | "chat" }[]>([]);
const chatText = ref("");
const busy = ref(false);

const currentNode = computed<MapNode | null>(
  () => map.value?.nodes.find((n) => n.code === map.value?.currentNodeCode) ?? null,
);

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
    say(`你走到了【${node.name}】。`);
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

const topMenus = ["功能", "帮助", "图鉴", "战斗力", "竞技场", "成就", "活动"];
const funcBtns = ["任务", "技能", "道具", "宝库", "宠物", "好友", "队伍", "公会"];
const slots = Array.from({ length: 12 }, (_, i) => i + 1);

onMounted(async () => {
  await load();
  say(`欢迎来到猫隐村，${props.characterName}！点击地图上的地点即可移动。`);
});
</script>

<template>
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
            <img v-if="map" :src="map.map.background" :alt="map.map.name" draggable="false" />
            <template v-if="map">
              <button
                v-for="n in map.nodes"
                :key="n.code"
                class="loc"
                :class="{ current: n.code === map.currentNodeCode, locked: n.locked }"
                :style="{ left: n.x * MAP_SCALE + 'px', top: n.y * MAP_SCALE + 'px' }"
                :title="n.name"
                @click="move(n)"
              >
                {{ n.short }}<i v-if="n.npcs.length" class="npc-count">{{ n.npcs.length }}</i>
              </button>
              <div
                v-if="currentNode"
                class="pet-mark"
                :style="{ left: currentNode.x * MAP_SCALE + 'px', top: currentNode.y * MAP_SCALE + 'px' }"
              >
                <img :src="petGif" :alt="characterName" />
              </div>
            </template>
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
          <div class="panel-head">{{ currentNode ? currentNode.name : "—" }} · NPC</div>
          <div class="body scr">
            <p v-if="!currentNode?.npcs.length" class="empty">这里空荡荡的，没有 NPC。</p>
            <div v-for="npc in currentNode?.npcs" :key="npc.name" class="npc-row">
              <b v-if="npc.title" :class="'t-' + (npc.titleColor || '')">{{ npc.title }}</b>
              <span>{{ npc.name }}</span>
              <a href="#" @click.prevent="todo('NPC 交谈')">交谈</a>
            </div>
          </div>
        </div>
        <div class="panel players-panel">
          <div class="panel-head">同格玩家</div>
          <div class="body scr">
            <p class="empty">当前没有其他玩家（单机模式）。</p>
          </div>
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
          <div class="panel-head">发言</div>
          <div class="input-row">
            <select><option>当前</option><option>世界</option></select>
            <input v-model="chatText" maxlength="80" placeholder="说点什么…" @keydown.enter.prevent="sendChat" />
            <button type="button" @click="sendChat">发送</button>
          </div>
        </div>
      </section>
    </div>

    <!-- 底栏 80px -->
    <footer class="bottombar">
      <div class="slots">
        <button v-for="s in slots" :key="s" type="button" class="slot" @click="todo('技能栏')">{{ s }}</button>
      </div>
      <div class="fbtns">
        <button v-for="f in funcBtns" :key="f" type="button" class="fbtn" @click="todo(f)">{{ f }}</button>
      </div>
    </footer>
  </main>
</template>

<style scoped>
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
.scene { flex: 1; min-height: 0; display: grid; place-items: center; background: #cde9f5; border: 1px solid #58b1d8; overflow: hidden; }
.mapview { position: relative; width: 600px; height: 450px; }
.mapview > img { width: 100%; height: 100%; object-fit: cover; image-rendering: auto; display: block; user-select: none; }
.loc {
  position: absolute;
  transform: translate(-50%, -50%);
  cursor: pointer;
  padding: 2px 8px;
  font: 12px "SimSun", serif;
  color: #14506e;
  background: #ffffe1;
  border: 1px solid #338ee1;
  border-radius: 3px;
  box-shadow: 0 1px 2px rgba(20, 80, 110, 0.35);
  white-space: nowrap;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.loc:hover { background: #338ee1; color: #fff; }
.loc.current { background: #d9a441; border-color: #8a5218; color: #fff; font-weight: 700; }
.loc.locked { color: #8b7b55; border-style: dashed; }
.npc-count {
  position: absolute;
  top: -7px;
  right: -7px;
  min-width: 14px;
  height: 14px;
  line-height: 14px;
  font-style: normal;
  font-size: 10px;
  text-align: center;
  color: #fff;
  background: #d63a2a;
  border-radius: 7px;
}
.pet-mark {
  position: absolute;
  transform: translate(-50%, -100%);
  pointer-events: none;
  filter: drop-shadow(0 2px 2px rgba(20, 80, 110, 0.5));
}
.pet-mark img { width: 40px; height: 40px; object-fit: contain; image-rendering: pixelated; display: block; }

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

.chatlog { height: 258px; }
.chatlog time { color: #8b7b55; margin-right: 4px; }
.chatlog p { margin: 1px 0; }
.chatlog p.chat { color: #1e5f3f; }

.center { width: 290px; display: flex; flex-direction: column; gap: 4px; min-height: 0; }
.npc-panel { flex: 3; }
.players-panel { flex: 2; }
.npc-row { display: flex; align-items: center; gap: 6px; padding: 2px 0; border-bottom: 1px dotted #bfe0ef; }
.npc-row b { font-weight: 400; }
.npc-row b.t-red { color: #d63a2a; font-weight: 700; }
.npc-row b.t-blue { color: #1e7fb8; font-weight: 700; }
.npc-row b.t-green { color: #2e8b57; font-weight: 700; }
.npc-row b.t-orange { color: #d9822b; font-weight: 700; }
.npc-row span { flex: 1; }

.right { flex: 1; display: flex; flex-direction: column; gap: 4px; min-height: 0; }
.drop-panel { flex: 2; }
.private-panel { flex: 2; }
.input-panel { flex: none; }
.input-row { display: flex; gap: 4px; padding: 5px 6px; }
.input-row select { width: 52px; font-size: 12px; }
.input-row input { flex: 1; min-width: 0; padding: 2px 6px; font-size: 12px; border: 1px solid #7fb8d4; }
.input-row button { cursor: pointer; padding: 2px 10px; font-size: 12px; border: 1px solid #14506e; background: #cde9f5; }

/* 底栏 */
.bottombar {
  height: 80px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  background: linear-gradient(#d9f0fa, #b7dcee);
  border-top: 1px solid #58b1d8;
}
.slots { display: flex; gap: 3px; }
.slot {
  width: 42px;
  height: 42px;
  cursor: pointer;
  font-size: 11px;
  color: #48788f;
  background: linear-gradient(#f4fbff, #cde9f5);
  border: 1px solid #58b1d8;
  border-radius: 4px;
}
.slot:hover { border-color: #338ee1; color: #14506e; }
.fbtns { display: flex; flex-wrap: wrap; gap: 4px; width: 320px; }
.fbtn {
  width: 76px;
  height: 24px;
  cursor: pointer;
  font-size: 12px;
  color: #14506e;
  background: linear-gradient(#f4fbff, #cde9f5);
  border: 1px solid #58b1d8;
  border-radius: 4px;
}
.fbtn:hover { border-color: #338ee1; background: #e4f5fd; }
</style>

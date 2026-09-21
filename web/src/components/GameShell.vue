<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  api,
  ApiError,
  type BattleEvent,
  type BattleResponse,
  type BattleResponseState,
  type Character,
  type ChatMessage,
  type MapCurrent,
  type MapNode,
  type NodeMonster,
} from "../api";

const props = defineProps<{
  username: string;
  character: Character;
  petGif: string;
}>();

const emit = defineEmits<{ switchView: []; characterChanged: [] }>();

const GW = 800;
const GH = 600;
const ZOOM = 1.8; // 视野拉远：可见范围约为全图 55.6%（与原型一致）
const camX = ref(0);
const camY = ref(0);

const map = ref<MapCurrent | null>(null);
const fitScale = ref(1);
/** 聊天记录行：战斗行在 push 时以当帧怪名烘焙分词结果（parts），战斗结束后历史行配色不回退 */
type LogLine =
  | { time: string; text: string; kind: "sys" | "chat" }
  | { time: string; text: string; kind: "battle"; parts: { t: string; cls: string }[] };
const messages = ref<LogLine[]>([]);
const chatBodyEl = ref<HTMLElement | null>(null); // 聊天记录滚动容器（自动贴底用）
const chatText = ref("");
const channel = ref("区域");
const CHANNEL_OF: Record<string, string> = { 区域: "area", 世界: "world", 私聊: "private" };
const worldMsgs = ref<ChatMessage[]>([]);
const privateMsgs = ref<ChatMessage[]>([]);
const chatTarget = ref("");
let chatTimer: number | undefined;
let sinceId = 0; // 轮询游标：已拿到的最大消息 id
let chatPolling = false; // 轮询在途标记：上一轮请求超 3s 未返回时跳过本轮，避免重复拉取
let chatSending = false; // 发送在途标记：防止连点/连按回车重复 POST

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("zh-CN", { hour12: false });
}

/** 按频道路由：世界 → 世界窗；其余（区域/私聊，未来公会/队伍）→ 私人信息窗 */
function routeChat(m: ChatMessage) {
  sinceId = Math.max(sinceId, m.id);
  if (m.channel === "world") worldMsgs.value.push(m);
  else privateMsgs.value.push(m);
  // 各窗上限 200 条：超出丢弃最旧的，避免长时间挂机时数组无限增长
  if (worldMsgs.value.length > 200) worldMsgs.value.splice(0, worldMsgs.value.length - 200);
  if (privateMsgs.value.length > 200) privateMsgs.value.splice(0, privateMsgs.value.length - 200);
}

async function pollChat() {
  if (chatPolling) return;
  chatPolling = true;
  try {
    const { messages } = await api.chatMessages(sinceId);
    for (const m of messages) routeChat(m);
  } catch {
    /* 轮询失败静默，下一轮重试 */
  } finally {
    chatPolling = false;
  }
}

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
  void nextTick(stickChat);
}

/** 聊天区自动贴底：新行追加后视口恒定跟随（照原型 addChat 无条件贴底；战斗时间线快进时一批可推入多行，阈值守卫会在批次掉队后永久失效，故不做阈值） */
function stickChat() {
  const el = chatBodyEl.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

/** 血量/蓝量百分比（封顶 0~100，防异常数据撑破条） */
function pct(v: number, max: number) {
  return Math.max(0, Math.min(100, (v / Math.max(1, max)) * 100));
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
    const res = await api.move(node.code);
    if (res.nodes) {
      // 跨图出口：服务端返回完整新图视图（含怪物实例），整体替换
      map.value = res as MapCurrent;
    } else if (res.node) {
      // 同图移动：仅更新当前格
      map.value!.currentNodeCode = res.node.code;
    }
  } catch (err) {
    if (isBattleConflict(err)) {
      await resumeBattle(); // 「战斗中无法移动」带 battleId：导回战斗视图
    } else {
      say(`【系统】${err instanceof Error ? err.message : "移动失败"}`);
    }
  } finally {
    busy.value = false;
  }
}

async function sendChat() {
  if (chatSending) return;
  chatSending = true;
  try {
    const text = chatText.value.trim();
    if (!text) return;
    const apiChannel = CHANNEL_OF[channel.value];
    if (!apiChannel) return; // 公会/队伍为禁用占位，正常选不到
    // 私聊目标为空时服务端会 400，客户端先拦截提示
    if (channel.value === "私聊" && !chatTarget.value.trim()) {
      say("【系统】请填写私聊目标");
      return;
    }
    await api.chatSend(apiChannel, text, channel.value === "私聊" ? chatTarget.value.trim() : undefined);
    chatText.value = "";
  } catch (err) {
    say(`【系统】${err instanceof Error ? err.message : "发送失败"}`);
  } finally {
    chatSending = false;
  }
}

/** 回车发送：过滤输入法组合中的 Enter 与按住自动重复，避免误发/重发 */
function onChatKeydown(e: KeyboardEvent) {
  if (e.isComposing || e.repeat) return;
  sendChat();
}

/** 切离私聊频道时清空目标名，避免残留值带进下次私聊 */
watch(channel, (v) => {
  if (v !== "私聊") chatTarget.value = "";
});

function todo(what: string) {
  say(`【系统】${what}将在后续切片开放。`);
}

// ---------- 战斗 ----------

/** 职业 preset 技能（MVP 口径：按职业直接可用，切片 5+ 接技能学习后替换） */
// 数值须与 server/data/skills.json 保持同步，切片 8 xlsx 导入后复核
const PRESET_SKILL: Record<
  Character["profession"],
  { code: string; name: string; sp: number; cdMs: number }
> = {
  warrior: { code: "qiangli_daji", name: "强力打击", sp: 25, cdMs: 5000 },
  mage: { code: "huoqiu_shu", name: "火球术", sp: 20, cdMs: 0 },
};
const presetSkill = computed(() => PRESET_SKILL[props.character.profession] ?? null);

const battleActive = ref(false);
const battle = ref<BattleResponseState | null>(null);
const foeLevel = ref(0); // 怪物等级：开战时取自点击项；/state 不回传等级，恢复态隐藏 Lv. 展示
const battleFloats = ref<{ id: number; target: "me" | "foe"; cls: string; text: string; jx: number }[]>([]);
const toastText = ref("");
const battleTick = ref(0); // 每秒自增，驱动 CD 遮罩等时间相关视图重算
let floatSeq = 0;
let battleSinceSeq = -1; // 战斗事件游标：恢复/全量拉取传 -1（seq 从 0 起，传 0 会丢首条事件）
let battleTimer: number | undefined;
let battlePolling = false; // 轮询在途标记：与聊天轮询同款并发防护
let battleEnding = false; // 终局结算倒计时中：不重复触发终局
let casting = false; // 技能激活在途标记：防连点重复 POST
let settleTimer: number | undefined;
let toastTimer: number | undefined;
/** 服务器时钟锚：以每次收包的 state.now 为基准，本地 Date.now() 只算偏移（勿直接比本地时钟） */
const clock = { serverNow: 0, localAt: 0 };

function toast(text: string) {
  toastText.value = text;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastText.value = "";
    toastTimer = undefined;
  }, 2500);
}

/** 409 且带 battleId =「战斗中」类冲突（移动/开战），应导回战斗视图；不带的（同怪被挑战/未刷新）仅提示 */
function isBattleConflict(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 409 && typeof err.body.battleId === "number";
}

/** 战斗日志行：text 服务端中文直出，push 时按「怪名」「你」烘焙上色分词（你=红、怪名=绿下划线，照原型格式） */
function pushBattleLine(text: string, t?: number) {
  messages.value.push({
    time: t ? new Date(t).toLocaleTimeString("zh-CN", { hour12: false }) : now(),
    text,
    kind: "battle",
    parts: battleParts(text, battle.value?.foeName ?? ""),
  });
  if (messages.value.length > 60) messages.value.shift();
  void nextTick(stickChat);
}

/** 日志行分词上色：仅按「怪名」「你」两个 token 切分，不做逐词解析；foeName 由调用方在 push 时传入 */
function battleParts(text: string, foeName: string): { t: string; cls: string }[] {
  const name = foeName;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${(name ? `${esc(name)}|` : "") + esc("你")})`, "g");
  return text
    .split(re)
    .filter(Boolean)
    .map((t) => ({ t, cls: t === name ? "mk" : t === "你" ? "you" : "" }));
}

/** 飘字生成：落点由 target 决定（受击方），1s 后随动画结束移除 */
function spawnFloat(target: "me" | "foe", cls: string, text: string) {
  const id = ++floatSeq;
  battleFloats.value.push({ id, target, cls, text, jx: Math.round(Math.random() * 28 - 14) });
  window.setTimeout(() => {
    battleFloats.value = battleFloats.value.filter((f) => f.id !== id);
  }, 1000);
}

// ---------- 战斗单位动作（照原型 unitAnim） ----------

const meUnitEl = ref<HTMLElement | null>(null);
const foeUnitEl = ref<HTMLElement | null>(null);

/** 出手前冲：原型 unitAnim 同款手法（移除类 → 强制 reflow → 加回），同类连发可重新起播；.5s 播完自然静止 */
function lunge(side: "me" | "foe") {
  const el = side === "me" ? meUnitEl.value : foeUnitEl.value;
  if (!el) return;
  el.classList.remove("atk");
  void el.offsetWidth; // 强制 reflow，保证动画从头重播
  el.classList.add("atk");
}

/** 终局倒地：victory 怪倒、defeat 我倒、draw 都不倒 */
function markDead(result: "victory" | "defeat" | "draw") {
  if (result === "victory") foeUnitEl.value?.classList.add("dead");
  else if (result === "defeat") meUnitEl.value?.classList.add("dead");
}

/** 清掉两个单位的 atk/dead 类：开战/恢复/收摊时调用，防跨场残留 */
function resetUnitAnim() {
  for (const el of [meUnitEl.value, foeUnitEl.value]) el?.classList.remove("atk", "dead");
}

/** 事件消费：side 是出手方 → 飘字落受击方；日志行恒追加（恢复回放时 animate=false 不飘字） */
function consumeEvent(e: BattleEvent, animate: boolean) {
  if (e.seq <= battleSinceSeq) return; // 去重：轮询与技能请求并发在途时可能带回同一批增量
  battleSinceSeq = Math.max(battleSinceSeq, e.seq);
  pushBattleLine(e.text, e.t);
  if (!animate) return;
  // 出手前冲：side 是出手方，hit/crit/skill/miss 都算一次出手动作（regen/stun/end 不冲）
  if (e.kind === "hit" || e.kind === "crit" || e.kind === "skill" || e.kind === "miss") {
    lunge(e.side);
  }
  const stricken: "me" | "foe" = e.side === "me" ? "foe" : "me"; // 受击方
  if (e.kind === "miss") {
    spawnFloat(stricken, "f-miss", "闪避");
  } else if (e.kind === "regen") {
    if (e.amount) spawnFloat(e.side, "f-heal", `+${e.amount}`);
  } else if (e.amount !== undefined) {
    spawnFloat(stricken, e.kind === "crit" ? "f-crit" : "f-dmg", `-${e.amount}`);
  }
}

/** 战斗响应统一入口：刷新时钟锚 → 建/续战斗态 → 消费增量事件 → 终局分流 */
function applyBattle(res: BattleResponse, animate = true) {
  clock.serverNow = res.state.now;
  clock.localAt = Date.now();
  if (!battleActive.value) {
    // 带 over 的响应必来自已收摊的旧战斗（全新开战的响应 over 恒为 null），勿借其在途 200「复活」战斗态
    if (res.state.over) return;
    foeLevel.value = 0; // 恢复态 /state 无等级，隐藏 Lv.；开战路径在调用后补点击项等级
    battleSinceSeq = -1;
    resetUnitAnim(); // 开战/恢复先清动作类，防上一场的前冲/倒地残留
    battleActive.value = true;
    startBattleTimer();
  }
  // 乱序守卫：技能响应与轮询快照并发在途时可能乱序到达，旧快照（now 更小）整包丢弃，防 HP/SP/CD 回跳
  if (battle.value && res.state.now < battle.value.now) return;
  battle.value = res.state;
  for (const e of res.events) consumeEvent(e, animate);
  // /skill 可能 200 + over 非空（这一击打出胜负，技能未激活 SP 未扣）——按终局处理
  if (res.state.over && !battleEnding) startSettlement(res.state.over);
}

/** 终局：不做胜利/战败横幅（战斗记录区已有击杀播报，按用户要求），短暂定格 180ms → 关覆盖层 → 重拉地图（尸体/复活可见）+ 通知 App 刷新角色（升级/回城即时反映） */
function startSettlement(over: NonNullable<BattleResponseState["over"]>) {
  battleEnding = true;
  markDead(over.result); // 终局倒地表现同帧出现（收摊极快，仅作瞬时反馈）
  settleTimer = window.setTimeout(() => {
    settleTimer = undefined;
    void finishSettlement();
  }, 180); // 用户要求 0.2 秒内退出战斗背景，留 20ms 余量
}

async function finishSettlement() {
  battleEnding = false;
  resetBattleUi();
  await load();
  emit("characterChanged");
  await resumeBattle(); // 照例复查（此处应为 404 静默，防极端时序漏检）
}

function resetBattleUi() {
  stopBattleTimer();
  battleActive.value = false;
  battle.value = null;
  battleFloats.value = [];
  resetUnitAnim(); // 收摊清动作类
}

/** 服务端已无进行中的战斗（轮询 404）且前端仍处战斗态：静默收摊刷新，防软锁 */
async function abandonBattle() {
  if (!battleActive.value || battleEnding) return;
  resetBattleUi();
  say("【系统】战斗已结束。");
  await load();
  emit("characterChanged");
}

/** 战斗恢复：GET /state(sinceSeq=-1) 全量拉取；404 视为无战斗静默跳过（挂载/每次 load 后调用） */
async function resumeBattle() {
  if (battleActive.value) return;
  try {
    const res = await api.battleState(-1);
    applyBattle(res, false); // 恢复的历史事件只进日志，不重放飘字
  } catch {
    /* 404=当前没有进行中的战斗；其余错误不重试，后续 move/开战 409 会重新尝试恢复 */
  }
}

async function pollBattle() {
  if (battlePolling || !battleActive.value) return;
  battlePolling = true;
  try {
    const res = await api.battleState(battleSinceSeq);
    applyBattle(res);
  } catch (err) {
    // over 结算后的下一次 /state 404 属正常态，勿报错；异常失同步时静默收摊防软锁
    if (err instanceof ApiError && err.status === 404) await abandonBattle();
    /* 其余错误静默，下一轮重试 */
  } finally {
    battlePolling = false;
  }
}

function startBattleTimer() {
  if (battleTimer) return;
  battleTimer = window.setInterval(() => {
    battleTick.value++;
    void pollBattle();
  }, 1000);
}

function stopBattleTimer() {
  if (battleTimer) {
    window.clearInterval(battleTimer);
    battleTimer = undefined;
  }
}

/* ---------- 怪物详情浮窗（照原型 #mon-pop：点名字开、点 ✕/点外部/开战关） ---------- */
const monPop = ref<NodeMonster | null>(null);
const monPopEl = ref<HTMLElement | null>(null);

/** 怪物行点击分流（照原型）：红笔图标=开战，其余（名字/空隙）=开详情浮窗 */
function onMonRowClick(m: NodeMonster, e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains("atk-ico")) void startBattle(m);
  else monShow(m, e);
}

/** 打开浮窗：nextTick 渲染后量宽高定位（照原型 monShow：紧贴鼠标下侧，右/底溢出翻到另一侧，贴边最小 8px） */
function monShow(m: NodeMonster, ev: MouseEvent) {
  monPop.value = m;
  void nextTick(() => {
    const el = monPopEl.value;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = ev.clientX + 2;
    let y = ev.clientY + 14;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 2; // 右溢出翻到左侧
    if (y + h > window.innerHeight - 8) y = ev.clientY - h - 6; // 底溢出翻到上侧
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    el.style.left = x + "px";
    el.style.top = y + "px";
  });
}

/** 浮窗内点击（照原型 monPanel click：整体 stopPropagation 防触发外部关闭）✕=关闭，红笔=开战并关浮窗 */
function onMonPopClick(e: MouseEvent) {
  e.stopPropagation();
  const t = e.target as HTMLElement;
  if (t.classList.contains("mx")) {
    monPop.value = null;
  } else if (t.tagName === "IMG" && t.classList.contains("atk-ico") && monPop.value) {
    const m = monPop.value;
    monPop.value = null; // 开战即关（照原型 attackMonster）
    void startBattle(m);
  }
}

/** 点浮窗外任意处关闭（照原型 document click 收起两个信息浮窗）；行内/浮窗点击已 stopPropagation，不会秒开秒关 */
function onDocClickHideMonPop() {
  monPop.value = null;
}

// 战斗覆盖层打开即关浮窗（开战/刷新后恢复战斗都会置 true，覆盖 resumeBattle 路径）
watch(battleActive, (v) => {
  if (v) monPop.value = null;
});

/** 点击怪物开战；「已有进行中的战斗」409 带 battleId → 导回战斗视图 */
async function startBattle(m: NodeMonster) {
  monPop.value = null; // 开战时关闭详情浮窗（照原型 attackMonster 先收浮窗；已开战时也收，仅不重复开战）
  if (battleActive.value) return;
  try {
    const res = await api.battleStart(m.id);
    applyBattle(res, false);
    foeLevel.value = m.level; // 名字/形象以快照回传为准，等级取自点击项
    pushBattleLine(`你向${m.name}发起攻击！`); // 开战行照原型补一条本地日志
    emit("characterChanged"); // 服务端 lazyRegen 可能已回血蓝，刷新角色面板
  } catch (err) {
    if (isBattleConflict(err)) {
      await resumeBattle();
    } else {
      toast(err instanceof Error ? err.message : "开战失败"); // 「该怪物正在被挑战」「怪物尚未刷新」仅提示
    }
  }
}

/** 服务器当前时刻估计：state.now +（本地 Date.now() − 收包时刻），勿直接比本地时钟 */
function serverNowEst(): number {
  return clock.serverNow + (Date.now() - clock.localAt);
}

/** CD 遮罩剩余比例（0=无 CD）；battleTick 依赖驱动每秒重算，CSS transition 补间平滑 */
const cdFraction = computed(() => {
  void battleTick.value;
  const st = battle.value;
  const cd = presetSkill.value?.cdMs ?? 0;
  if (!st || cd <= 0 || !st.skillCdUntil) return 0;
  const remain = st.skillCdUntil - serverNowEst();
  return remain <= 0 ? 0 : Math.min(1, remain / cd);
});

const charged = computed(
  () => battleActive.value && battle.value?.pendingSkill?.code === presetSkill.value?.code,
);
const spShort = computed(() => {
  const st = battle.value;
  const sk = presetSkill.value;
  return battleActive.value && !!st && !!sk && (st.sp ?? 0) < sk.sp;
});

const meFloats = computed(() => battleFloats.value.filter((f) => f.target === "me"));
const foeFloats = computed(() => battleFloats.value.filter((f) => f.target === "foe"));

/** 释放职业 preset 技能（战斗中）；客户端先按本地态拦截明显无效请求，服务端 400 message 兜底 toast */
async function castPreset() {
  const st = battle.value;
  const sk = presetSkill.value;
  if (!st || !sk || st.over || casting) return;
  if (st.pendingSkill?.code === sk.code) return; // 已强化待发，勿重复激活
  if (cdFraction.value > 0) return; // CD 遮罩期忽略
  if ((st.sp ?? 0) < sk.sp) return; // SP 不足置灰，点击无效
  casting = true;
  try {
    const res = await api.battleSkill(sk.code, battleSinceSeq);
    applyBattle(res);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404) await abandonBattle();
      else toast(err.message); // 「SP 不足」「技能冷却中」「已有待发的技能」等直接提示
    } else {
      toast("技能释放失败");
    }
  } finally {
    casting = false;
  }
}

/** 快捷键 1 释放：过滤输入法组合/长按重复/输入框聚焦（守卫照聊天输入写法） */
function onGlobalKeydown(e: KeyboardEvent) {
  if (e.isComposing || e.repeat) return;
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
  if (e.key === "1" && battleActive.value) {
    e.preventDefault();
    void castPreset();
  }
}

function onSlotClick(i: number) {
  if (i === 0 && battleActive.value) {
    void castPreset();
    return;
  }
  todo("技能书");
}

/** 舞台等比缩放：窗口小于 1400×832 时整体缩小，避免截断与横向滚动 */
function fitStage() {
  fitScale.value = Math.max(0.4, Math.min(window.innerWidth / 1484, (window.innerHeight - 28) / 908, 1));
}

const topMenus = ["功能", "帮助", "图鉴", "战斗力", "竞技场", "成就", "活动"];
const funcBtns = ["任务", "技能", "道具", "宝库", "宠物", "好友", "队伍", "公会"];
const SLOT_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 10, 11, 12];
/** 技能栏 12 格：slot 0 装职业 preset 技能（战斗中可点/快捷键 1），其余留待后续切片 */
const skillSlots = ref<(string | null)[]>(Array(12).fill(null));

onMounted(async () => {
  fitStage();
  window.addEventListener("resize", fitStage);
  window.addEventListener("keydown", onGlobalKeydown);
  document.addEventListener("click", onDocClickHideMonPop);
  await load();
  await resumeBattle(); // 挂载恢复：刷新/换角色再进不会把角色留在无人推进的战斗里
  await pollChat();
  chatTimer = window.setInterval(pollChat, 3000);
  say(`欢迎来到猫隐村，${props.character.name}！点击地图上的地点即可移动。`);
});

onUnmounted(() => {
  window.removeEventListener("resize", fitStage);
  window.removeEventListener("keydown", onGlobalKeydown);
  document.removeEventListener("click", onDocClickHideMonPop);
  if (chatTimer) window.clearInterval(chatTimer);
  stopBattleTimer();
  if (settleTimer) window.clearTimeout(settleTimer);
  if (toastTimer) window.clearTimeout(toastTimer);
});
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
                <img :src="petGif" :alt="character.name" />
              </div>
            </template>
            </div>
          </div>

          <!-- 战斗覆盖层：铺满场景挡住地图/NPC 点击（战斗中禁止移动），视觉照原型 #battle 段 -->
          <div v-if="battleActive && battle" class="battle-layer">
            <div class="bt-stat pos-me">
              <div class="bt-stat-name">{{ character.name }} Lv.{{ character.level }}</div>
              <div class="bar hp">
                <i :style="{ width: pct(battle.hp, battle.maxHp) + '%' }"></i>
                <span>{{ Math.max(0, battle.hp) }}/{{ battle.maxHp }}</span>
              </div>
              <div v-if="battle.sp !== undefined && battle.maxSp !== undefined" class="bar mp">
                <i :style="{ width: pct(battle.sp, battle.maxSp) + '%' }"></i>
                <span>{{ battle.sp }}/{{ battle.maxSp }}</span>
              </div>
            </div>
            <div class="bt-stat pos-foe">
              <div class="bt-stat-name">
                {{ battle.foeName }}<template v-if="foeLevel"> Lv.{{ foeLevel }}</template>
              </div>
              <div class="bar hp">
                <i :style="{ width: pct(battle.foeHp, battle.foeMaxHp) + '%' }"></i>
                <span>{{ Math.max(0, battle.foeHp) }}/{{ battle.foeMaxHp }}</span>
              </div>
            </div>

            <div class="bt-stage">
              <div ref="meUnitEl" class="bt-unit bt-me">
                <div class="bt-sprite"><img :src="petGif" :alt="character.name" /></div>
                <div class="bt-shadow"></div>
              </div>
              <div ref="foeUnitEl" class="bt-unit bt-foe">
                <div class="bt-sprite"><img v-if="battle.foeSprite" :src="battle.foeSprite" :alt="battle.foeName" /></div>
                <div class="bt-shadow"></div>
              </div>
              <!-- 伤害飘字：落受击方（事件 side 是出手方）；红伤害/橙暴击放大/灰闪避/绿回血 -->
              <div class="floats-me">
                <span
                  v-for="f in meFloats"
                  :key="f.id"
                  class="bt-float"
                  :class="f.cls"
                  :style="{ marginLeft: f.jx + 'px' }"
                >{{ f.text }}</span>
              </div>
              <div class="floats-foe">
                <span
                  v-for="f in foeFloats"
                  :key="f.id"
                  class="bt-float"
                  :class="f.cls"
                  :style="{ marginLeft: f.jx + 'px' }"
                >{{ f.text }}</span>
              </div>
            </div>
          </div>

          <!-- 轻提示（409 无 battleId / 技能被拒等） -->
          <div v-if="toastText" class="toast">{{ toastText }}</div>
        </div>
        <div class="chatlog panel">
          <div ref="chatBodyEl" class="body scr">
            <p v-for="(m, i) in messages" :key="i" :class="m.kind">
              <time>{{ m.time }}</time>
              <!-- 战斗日志行：你=红 #F52627、怪名=绿下划线（格式照原型）；parts 已在 push 时烘焙，历史行不再重建 -->
              <template v-if="m.kind === 'battle'">
                <template v-for="(p, j) in m.parts" :key="j">
                  <span v-if="p.cls" :class="p.cls">{{ p.t }}</span>
                  <template v-else>{{ p.t }}</template>
                </template>
              </template>
              <template v-else>{{ m.text }}</template>
            </p>
          </div>
        </div>
      </section>

      <div class="side">
        <div class="side-top">
      <!-- 中：NPC / 玩家 -->
      <section class="center">
        <div class="panel npc-panel">
          <div class="panel-head">{{ currentNode ? currentNode.name : "—" }}</div>
          <div class="body scr">
            <p v-if="!currentNode?.npcs.length && !currentNode?.monsters?.length" class="empty">这里空荡荡的，没有 NPC。</p>
            <!-- 野外格怪物列表（照原型）：绿名 + 红笔攻击图标，无血条/等级；点名字开详情浮窗，点红笔开战 -->
            <div
              v-for="m in currentNode?.monsters ?? []"
              :key="'m' + m.id"
              class="mon"
              @click.stop="onMonRowClick(m, $event)"
            >
              <b class="mname" title="查看怪物详情">{{ m.name }}</b>
              <!-- 红笔攻击图标（照原型 .npc img.atk-ico）：点它发起攻击 -->
              <img class="atk-ico" src="/icons/attack.gif" alt="攻击" title="攻击" />
            </div>
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

      <!-- 右：消息窗 -->
      <section class="right">
        <div class="panel drop-panel">
          <div class="body scr">
            <p v-if="!worldMsgs.length" class="empty">暂无公告。</p>
            <p v-for="m in worldMsgs" :key="m.id" class="msg c-world">
              <time>{{ fmtTime(m.createdAt) }}</time><span class="name">{{ m.senderName }}</span>：{{ m.content }}
            </p>
          </div>
        </div>
        <div class="panel private-panel">
          <div class="body scr">
            <!-- 常驻首行提示（#74A5CF），随聊天记录增多被顶上去 -->
            <p class="empty private-hint">私人信息显示窗口,你的聊天和别人对你的聊天显示在本窗口</p>
            <template v-for="m in privateMsgs" :key="m.id">
              <!-- 私聊模板（用户指定）：名字下划线、「你」字红 #F52627 -->
              <p v-if="m.channel === 'private'" class="msg c-private">
                <time>{{ fmtTime(m.createdAt) }}</time>
                <template v-if="m.senderName === character.name">
                  <span class="you">你</span> 对 <span class="name">{{ m.targetName }}</span> 说: {{ m.content }}
                </template>
                <template v-else>
                  <span class="name">{{ m.senderName }}</span> 对 <span class="you">你</span> 说: {{ m.content }}
                </template>
              </p>
              <!-- 区域（未来公会/队伍同构，仅 c- 类换色） -->
              <p v-else class="msg" :class="'c-' + m.channel">
                <time>{{ fmtTime(m.createdAt) }}</time><span class="name">{{ m.senderName }}</span>：{{ m.content }}
              </p>
            </template>
          </div>
        </div>
      </section>
        </div>
        <div class="panel input-panel">
          <select v-model="channel">
            <option>区域</option><option>世界</option><option>私聊</option>
            <option disabled>公会</option><option disabled>队伍</option>
          </select>
          <input v-if="channel === '私聊'" v-model="chatTarget" class="target" maxlength="32" placeholder="目标角色名" />
          <input v-model="chatText" maxlength="60" placeholder="在这里输入聊天内容…" @keydown.enter.prevent="onChatKeydown" />
          <button type="button" @click="sendChat">输入</button>
        </div>
      </div>
    </div>

    <!-- 底栏 80px -->
    <footer class="bottombar">
      <div class="bar-main">
        <div class="skillzone">
          <div class="slots">
            <div
              v-for="(k, i) in SLOT_KEYS"
              :key="i"
              class="slot"
              :class="{
                charged: i === 0 && charged,
                disabled: i === 0 && spShort,
              }"
              :title="i === 0 && presetSkill
                ? (battleActive
                  ? `${presetSkill.name}（快捷键 1，战斗中点击释放，消耗 ${presetSkill.sp} SP）`
                  : `${presetSkill.name}（快捷键 1，进入战斗后可释放）`)
                : skillSlots[i] ? `技能（快捷键 ${k}）` : `空技能格（快捷键 ${k}，装备技能后此处显示图标）`"
              @click="onSlotClick(i)"
            >
              <template v-if="i === 0 && presetSkill">
                <b class="sk-name">{{ presetSkill.name }}</b>
                <i class="sptag">{{ presetSkill.sp }}</i>
                <i v-if="charged" class="charged-tag">已强化</i>
                <!-- CD 遮罩：倒计时基准为服务器时钟（state.now + 本地偏移），深色自上而下消退 -->
                <i v-if="cdFraction > 0" class="cd" :style="{ height: cdFraction * 100 + '%' }"></i>
              </template>
              <i class="key">{{ k }}</i>
            </div>
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

  <!-- 怪物详情浮窗（照原型 #mon-pop）：fixed 紧贴鼠标、左图右文 + 底部描述。
       Teleport 到 body：stage-fit 的 transform 缩放会把 fixed 定位劫持为相对自身，故挂到根节点照原型用视口坐标 -->
  <Teleport to="body">
    <div v-if="monPop" id="mon-pop" ref="monPopEl" @click="onMonPopClick">
      <span class="mx" title="关闭">✕</span>
      <table>
        <tbody>
          <tr>
            <td class="mi"><img :src="monPop.sprite" :alt="monPop.name" /></td>
            <td>
              <div class="mn">
                {{ monPop.name }}<img class="atk-ico" src="/icons/attack.gif" alt="攻击" title="攻击" />
              </div>
              <div class="ml">Lv.{{ monPop.level }} ({{ monPop.type ?? "未知" }})</div>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="md">{{ monPop.desc ?? "（图鉴暂未收录此怪物。）" }}</div>
    </div>
  </Teleport>
</template>

<style scoped>
.stage-fit {
  display: flex;
  justify-content: center;
  height: calc((832px + 24px) * var(--fit-scale, 1));
  overflow: hidden;
}
.shell {
  flex: none;
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
.left { width: 660px; flex: none; min-width: 0; display: flex; flex-direction: column; gap: 4px; min-height: 0; }
.scene { position: relative; flex: none; aspect-ratio: 4 / 3; background: #cde9f5; border: 1px solid #58b1d8; overflow: hidden; }
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
/* 形象尺寸按用户要求 2 倍于原型（原型 .bt-sprite img 为 80px、地图形象 60px） */
.pet-mark img { height: 120px; width: auto; display: block; }
@keyframes bob { 50% { transform: translate(-50%, calc(-50% - 3px)); } }
@media (prefers-reduced-motion: reduce) { .pet-mark { animation: none; } }

/* ---------- 战斗覆盖层（视觉照旧仓库原型 #battle 段 v2） ---------- */
.battle-layer {
  position: absolute;
  inset: 0;
  z-index: 30;
  overflow: hidden;
  background: url("/battle/muyecaoyuan.gif") center / cover no-repeat;
}
.bt-stat {
  position: absolute;
  z-index: 8;
  width: 236px;
  padding: 6px 9px;
  border-radius: 6px;
  background: rgba(16, 32, 46, 0.58);
  border: 1px solid rgba(255, 255, 255, 0.22);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
}
.bt-stat.pos-me { left: 12px; top: 12px; }
.bt-stat.pos-foe { right: 12px; top: 12px; }
.bt-stat-name {
  margin-bottom: 3px;
  font: bold 13px SimHei, "黑体", "SimSun", serif;
  color: #fff;
  text-shadow: 0 1px 2px #000;
  white-space: nowrap;
}
/* 血/蓝格子（嵌数字）按用户要求加高至 20px（原型 14px），数字放大并随 line-height 垂直居中 */
.bar {
  position: relative;
  height: 20px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.45);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}
.bar + .bar { margin-top: 6px; }
.bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 9px; transition: width 0.3s ease; }
.bar.hp i { background: linear-gradient(#a4e88a, #4fc24a 45%, #2f9e3f); }
.bar.mp i { background: linear-gradient(#8ec9f0, #4a9fd8 45%, #2f7fc0); }
.bar span {
  position: relative;
  display: block;
  font: bold 11px/20px Tahoma, Verdana, sans-serif; /* line-height 随格子加高，保证数字垂直居中 */
  color: #fff;
  text-align: center;
  text-shadow: 0 0 3px #000, 0 1px 1px #000;
}
.bt-stage {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  padding: 30px 46px 26px;
}
.bt-unit { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 170px; }
.bt-sprite { display: flex; align-items: flex-end; justify-content: center; filter: drop-shadow(0 3px 2px rgba(20, 40, 20, 0.35)); }
.bt-sprite img { height: 160px; width: auto; image-rendering: pixelated; }
.bt-shadow { width: 184px; height: 13px; border-radius: 50%; background: rgba(30, 60, 30, 0.25); }
/* 飘字锚点：与两侧单位对齐（stage 左右 padding 46px + 单位宽 170px）；bottom 随精灵 2 倍放大上移，保证飘字在头顶之上 */
.floats-me, .floats-foe { position: absolute; bottom: 220px; width: 170px; height: 2px; pointer-events: none; }
.floats-me { left: 46px; }
.floats-foe { right: 46px; }
.bt-float {
  position: absolute;
  left: 50%;
  z-index: 9;
  font: bold 22px Verdana, sans-serif;
  color: #e02010;
  text-shadow: 0 1px 2px #fff;
  white-space: nowrap;
  animation: floatUp 0.95s ease-out forwards;
}
.bt-float.f-crit { color: #ff8c00; font-size: 30px; }
.bt-float.f-miss { color: #888; font-size: 18px; }
.bt-float.f-heal { color: #2f9e3f; }
@keyframes floatUp {
  from { opacity: 1; transform: translate(-50%, 0); }
  70% { opacity: 1; }
  to { opacity: 0; transform: translate(-50%, -54px); }
}
@media (prefers-reduced-motion: reduce) { .bt-float { animation: none; opacity: 0; } }
/* 出手前冲与终局倒地（CSS 照原型逐字）：我方在左往右冲、怪在右往左冲 */
.bt-me.atk .bt-sprite { animation: lungeR .5s ease; }
.bt-foe.atk .bt-sprite { animation: lungeL .5s ease; }
@keyframes lungeR { 35% { transform: translateX(64px); } }
@keyframes lungeL { 35% { transform: translateX(-64px); } }
.bt-unit.dead .bt-sprite { filter: grayscale(1) brightness(.65); transform: translateY(12px) rotate(9deg); transition: all .6s ease; }
@media (prefers-reduced-motion: reduce) { .bt-me.atk .bt-sprite, .bt-foe.atk .bt-sprite { animation: none; } }
/* 场景内轻提示 */
.toast {
  position: absolute;
  z-index: 40;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 80%;
  padding: 5px 14px;
  border-radius: 4px;
  background: rgba(60, 20, 10, 0.82);
  color: #ffe9dd;
  font: 12px/1.6 "SimSun", "宋体", serif;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}

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
.panel > .body { background: #C2E1EB; }
.body.scr::-webkit-scrollbar { width: 8px; }
.body.scr::-webkit-scrollbar-thumb { background: #8db8cd; border-radius: 4px; }
.empty { color: #8b7b55; }
.private-hint { color: #74A5CF; font-size: 14px; font-weight: 800; text-shadow: 0 0 0.4px currentColor; text-align: left; margin: -3px 0 0; }

.chatlog { flex: 1; min-height: 0; }
.chatlog time { color: #8b7b55; margin-right: 4px; }
.chatlog p {
  margin: 1px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chatlog p.chat { color: #1e5f3f; }
/* 战斗日志行配色（照原型）：你=红、怪名=绿下划线 */
.chatlog .you { color: #f52627; }
.chatlog .mk { color: #178714; text-decoration: underline; }

.center { width: 290px; flex: none; min-width: 0; overflow: hidden; display: flex; flex-direction: column; gap: 4px; min-height: 0; }
.npc-panel { flex: 3; }
.npc-panel .panel-head { text-align: center; color: #000; font-weight: bold; }
.players-panel { flex: 2; }
.npc { display: flex; align-items: center; gap: 4px; line-height: 20px; white-space: nowrap; overflow: hidden; cursor: pointer; }
.npc:hover { background: #d9eef8; }
.npc b { color: #212627; font-weight: bold; }
.npc b:hover { color: #0d6ba8; }
.npc svg { width: 12px; height: 12px; flex: none; }
.npc .tt { flex: none; font-weight: 400; }
.npc .tt.t-red { color: #c33812; }
.npc .tt.t-blue { color: #2b6fc4; }
.npc .tt.t-green { color: #178714; }
.npc .tt.t-orange { color: #d97a00; }

/* 怪物列表行（野外格，照原型 .npc）：深蓝名 + 红笔攻击图标（无血条/等级）；点名字开详情浮窗，点红笔开战 */
.mon { display: flex; align-items: center; gap: 4px; line-height: 20px; white-space: nowrap; overflow: hidden; cursor: pointer; }
.mon:hover { background: #d9eef8; }
.mon .mname { color: #14506e; font-weight: bold; white-space: nowrap; }
.mon:hover .mname { color: #0d6ba8; }
.mon .atk-ico { width: 12px; height: 12px; flex: none; cursor: pointer; }

/* 怪物详情浮窗（照原型 #mon-pop）：#eee 底、深色细边框 + 内圈浅灰线；左侧怪物图，右侧名称/红笔/等级类型，底部描述。
   显隐由 v-if 接管（原型的 display:none 切换在此不需要） */
#mon-pop {
  position: fixed;
  z-index: 120;
  width: 370px;
  background: #eee;
  border: 1px solid #2e2e2e;
  box-shadow: inset 0 0 0 1px #c6c6c6, 1px 1px 3px rgba(0, 0, 0, 0.4);
  padding: 20px 10px 12px 14px;
}
#mon-pop .mx { position: absolute; top: 5px; right: 6px; font: bold 14px/1 Tahoma, SimSun; color: #111; cursor: pointer; padding: 3px; }
#mon-pop .mx:hover { color: #c33812; }
#mon-pop table { border-collapse: collapse; }
#mon-pop td.mi { width: 200px; text-align: center; vertical-align: middle; }
#mon-pop td.mi img { width: 129px; display: block; margin: 0 auto; }
#mon-pop .mn { font: bold 19px/22px SimSun; color: #222; white-space: nowrap; }
#mon-pop .mn img { width: 14px; height: 14px; margin-left: 14px; cursor: pointer; vertical-align: 1px; }
#mon-pop .ml { margin-top: 11px; width: 146px; font: 17px/25px SimSun; color: #333; }
#mon-pop .md { margin-top: 12px; font: 13px/1.7 SimSun; color: #555; }

.right { flex: 1; min-width: 300px; display: flex; flex-direction: column; gap: 4px; min-height: 0; }
.side { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.side-top { flex: 1; min-height: 0; display: flex; gap: 4px; }
.drop-panel { flex: 2; }
.private-panel { flex: 2; }
/* 覆盖 .panel 的 flex-direction: column，让 频道选择/输入框/按钮 保持同一行 */
.input-panel { flex: none; height: 38px; display: flex; flex-direction: row; align-items: center; gap: 5px; padding: 0 6px; }
.input-panel select {
  width: 62px; height: 24px; font: 12px "SimSun", "宋体", serif; color: #1a1a1a; background: #fff; cursor: pointer;
  border: 1px solid #7f7f7f; box-shadow: inset 1px 1px 0 #d4d0c8;
}
.input-panel input {
  flex: 1; min-width: 0; height: 24px; line-height: 22px; font: 12px "SimSun", "宋体", serif; padding: 0 6px; color: #111; background: #fff;
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

/* 聊天消息（世界窗/私人信息窗共用）：频道配色为用户指定色值，见 docs/聊天系统设计.md */
.msg { margin: 1px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.msg time { color: #8b7b55; margin-right: 4px; }
.msg .name { text-decoration: underline; }
.you { color: #f52627; }
.c-area { color: #363a3c; }
.c-world { color: #363a3c; } /* 与区域聊同色（2026-09-21 用户指定） */
.c-private { color: #058306; }
.c-guild { color: #5991ca; }
.c-team { color: #8b4513; }
/* 私聊目标名输入框：固定宽（spec 值 70px），不参与 flex 伸展 */
.input-panel input.target { flex: none; width: 70px; }

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
.skillzone { position: relative; flex: none; height: 56px; width: 640px; display: flex; align-items: center; gap: 6px; padding: 0 4px; background: rgba(20, 60, 90, 0.28); border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 6px; }
.slots { display: flex; gap: 5px; }
.slot {
  position: relative;
  width: 44px;
  height: 40px;
  flex: none;
  cursor: pointer;
  border-radius: 4px;
  background: linear-gradient(#48a1c8, #449ec5 30%, #439dc4 45%, #45a0c7 62%, #409ac1);
  border: 1px solid #000;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 1px 2px rgba(0, 0, 0, 0.2);
}
.slot:hover { box-shadow: inset 0 0 0 2px rgba(255, 240, 170, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.25); }
/* slot 0：职业 preset 技能（名 + SP 角标） */
.slot .sk-name {
  position: absolute;
  left: 0;
  right: 0;
  top: 3px;
  overflow: hidden;
  text-align: center;
  font: bold 11px/14px "SimSun", "宋体", serif;
  color: #fff;
  text-shadow: 0 1px 1px rgba(20, 60, 90, 0.9);
  white-space: nowrap;
}
.slot .sptag {
  position: absolute;
  right: 1px;
  bottom: 2px;
  font: bold 9px/12px Tahoma, Verdana, sans-serif;
  font-style: normal;
  color: #bfe3ff;
  text-shadow: 0 1px 1px #000;
}
.slot .charged-tag {
  position: absolute;
  left: 0;
  right: 0;
  top: 18px;
  text-align: center;
  font: bold 10px/12px "SimSun", "宋体", serif;
  font-style: normal;
  color: #ffd34d;
  text-shadow: 0 1px 1px #000;
  pointer-events: none;
}
/* 已强化高亮 / SP 不足置灰（已强化优先展示，不被置灰滤镜盖住） */
.slot.charged { box-shadow: inset 0 0 0 2px #ffd34d, inset 0 1px 0 rgba(255, 255, 255, 0.25); }
.slot.disabled:not(.charged) { filter: grayscale(0.9) brightness(0.72); }
.slot.disabled:not(.charged):hover { box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 1px 2px rgba(0, 0, 0, 0.2); }
/* CD 遮罩：深色自上而下消退，高度由 cdFraction 驱动、transition 补间平滑 */
.slot .cd {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 0;
  background: rgba(10, 25, 40, 0.65);
  transition: height 1s linear;
  pointer-events: none;
}
.slot .key {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -15px;
  text-align: center;
  font: bold 11px/13px Tahoma, Verdana, sans-serif;
  font-style: normal;
  color: #fff;
  text-shadow: 0 1px 1px rgba(20, 60, 90, 0.8);
}
.pagebtns { position: static; width: 40px; height: 44px; cursor: pointer; }
.pagebtns i { position: absolute; left: 0; width: 100%; height: 50%; }
.pagebtns i:hover { background: rgba(255, 255, 255, 0.22); }
.fbtns { flex: 1; display: flex; justify-content: space-evenly; align-items: center; min-width: 0; }
.fbtn { cursor: pointer; line-height: 0; }
.fbtn img { width: 60px; height: 60px; }
.fbtn:hover { filter: brightness(1.13); }
</style>

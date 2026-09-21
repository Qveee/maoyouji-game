export interface Character {
  id: number;
  name: string;
  profession: "warrior" | "mage";
  breedCode: string;
  level: number;
  exp: number;
  vit: number;
  str: number;
  agi: number;
  intel: number;
  spr: number;
  hp: number;
  sp: number;
}

export interface Pet {
  code: string;
  name: string;
  description: string;
  sprite: string;
  baseStats: Record<string, number>;
}

export interface MapNpc {
  name: string;
  title: string;
  titleColor: string;
}

/** 野外格怪物实例（GET /map/current 仅对 field 图节点下发，城镇节点无该字段） */
export interface NodeMonster {
  id: number;
  code: string;
  name: string;
  hp: number;
  maxHp: number;
  level: number;
  sprite: string; // 如 /monsters/LuMaoChong.gif，直接可作 img src
  type?: string; // 图鉴定位类型（如「战士 昆虫辅助」），缺省时详情浮窗显示「未知」
  desc?: string; // 图鉴描述文案，缺省时详情浮窗显示兜底提示
}

export interface MapNode {
  code: string;
  name: string;
  short: string;
  x: number;
  y: number;
  locked: boolean;
  lockedReason: string | null;
  npcs: MapNpc[];
  monsters?: NodeMonster[];
}

export interface MapCurrent {
  map: { code: string; name: string; type: string; background: string };
  currentNodeCode: string | null;
  nodes: MapNode[];
}

/** 与 server/src/routes/chat.ts toMessage() 输出一一对应 */
export interface ChatMessage {
  id: number;
  channel: "area" | "world" | "private" | "guild" | "team";
  senderId: number;
  senderName: string;
  targetName: string | null;
  nodeCode: string | null;
  content: string;
  createdAt: string; // ISO UTC，展示时转本地时间
}

// ---------- 战斗（与 server/src/routes/battle.ts toResponseState、game/engine.ts 对齐） ----------

/** 战斗事件：side 是出手方（飘字应落受击方）；text 为服务端预生成的中文，直接展示 */
export interface BattleEvent {
  seq: number;
  t: number; // 服务器毫秒时刻
  side: "me" | "foe";
  kind: "hit" | "crit" | "miss" | "skill" | "stun" | "regen" | "end";
  amount?: number;
  text: string;
}

/** 待发技能载荷（activateSkill 标记，玩家下一次出手按此结算） */
export interface BattlePendingSkill {
  code: string;
  name: string;
  kind: "next_hit_bonus" | "direct_damage";
  bonusDamage?: number;
  dmgMin?: number;
  dmgMax?: number;
  stunMs?: number;
}

/** 战斗响应态：前端渲染所需字段（SP 缺省时省略；over 非空即终局） */
export interface BattleResponseState {
  hp: number;
  maxHp: number;
  sp?: number;
  maxSp?: number;
  foeHp: number;
  foeMaxHp: number;
  foeMaxSp?: number;
  foeName: string; // 怪物名（快照内 foe.name，恢复/轮询直接展示）
  foeSprite: string; // 怪物精灵图，如 /monsters/LuMaoChong.gif，直接可作 img src
  pendingSkill: BattlePendingSkill | null;
  skillCdUntil: number; // 服务器时钟毫秒；倒计时须以 state.now 锚定，勿直接比本地时钟
  now: number; // 服务器当前毫秒（本地时钟锚定基准）
  over: null | { result: "victory" | "defeat" | "draw"; expGained?: number };
}

export interface BattleResponse {
  state: BattleResponseState;
  events: BattleEvent[]; // 仅含 seq > sinceSeq 的增量
}

/** /map/move 响应：同图返回 node 简要；跨图出口返回完整新图视图（与 MapCurrent 同构） */
export type MapMoveResult = { node?: { code: string; name: string; short: string } } & Partial<MapCurrent>;

/**
 * 类型化 API 错误：携带 HTTP 状态码与响应体。
 * 调用方据此分流——如 409 带 body.battleId 表示「战斗中」需导回战斗视图，
 * 400 的 message（SP 不足/技能冷却中等）直接提示。
 */
export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body != null;
  const res = await fetch(url, {
    ...init,
    headers: { ...(hasBody ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = typeof body.message === "string" ? body.message : `请求失败(${res.status})`;
    throw new ApiError(res.status, body, message);
  }
  return body as T;
}

export const api = {
  register: (username: string, password: string) =>
    request<{ username: string }>("/api/auth/register", { method: "POST", body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) =>
    request<{ username: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  me: () => request<{ username: string; characterId: number | null }>("/api/auth/me"),
  characters: () => request<{ characters: Character[] }>("/api/characters"),
  createCharacter: (name: string, breedCode: string, profession: "warrior" | "mage") =>
    request<Character>("/api/characters", { method: "POST", body: JSON.stringify({ name, breedCode, profession }) }),
  deleteCharacter: (id: number) => request<{ ok: boolean }>(`/api/characters/${id}`, { method: "DELETE" }),
  selectCharacter: (characterId: number) =>
    request<{ characterId: number }>("/api/auth/select-character", { method: "POST", body: JSON.stringify({ characterId }) }),
  pets: () => request<{ pets: Pet[] }>("/api/pets"),
  mapCurrent: () => request<MapCurrent>("/api/map/current"),
  move: (toCode: string) =>
    request<MapMoveResult>("/api/map/move", {
      method: "POST",
      body: JSON.stringify({ toCode }),
    }),
  chatMessages: (sinceId?: number) =>
    request<{ messages: ChatMessage[] }>(`/api/chat/messages${sinceId ? `?sinceId=${sinceId}` : ""}`),
  chatSend: (channel: string, content: string, targetName?: string) =>
    request<{ message: ChatMessage }>("/api/chat/send", {
      method: "POST",
      body: JSON.stringify({ channel, content, targetName }),
    }),
  // 发起战斗：409「已有进行中的战斗」带 body.battleId；「该怪物正在被挑战」「怪物尚未刷新」不带
  battleStart: (monsterInstanceId: number) =>
    request<BattleResponse>("/api/battle/start", {
      method: "POST",
      body: JSON.stringify({ monsterInstanceId }),
    }),
  // 轮询推进：无 active 战斗返回 404（over 结算后的例行 404 属正常态）；
  // sinceSeq 语义为「只回 seq > sinceSeq」，全量拉取传 -1（seq 从 0 起，传 0 会丢首条事件）
  battleState: (sinceSeq: number) => request<BattleResponse>(`/api/battle/state?sinceSeq=${sinceSeq}`),
  // 技能激活：200 + over 非空表示这一击打出胜负（技能未激活、SP 未扣）；400 的 message 直接可提示
  battleSkill: (code: string, sinceSeq: number) =>
    request<BattleResponse>(`/api/battle/skill?sinceSeq=${sinceSeq}`, {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
};

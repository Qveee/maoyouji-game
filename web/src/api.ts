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
  /** width/height=原版页面坐标空间（节点 x/y 参照系），各图尺寸不一，前端据此铺背景/摆点位 */
  map: { code: string; name: string; type: string; background: string; width: number; height: number };
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
  over: null | {
    result: "victory" | "defeat" | "draw";
    expGained?: number;
    killCount?: number; // 累计斩杀数（结算时服务端补写）
    totalExpGained?: number; // 该怪累计获取经验（结算时服务端补写）
    /** 掉落展示快照（victory 结算回填）：items 含全部掷出条目，lost 为满包丢失部分 */
    drops?: {
      copper: number;
      items: { code: string; name: string; quality: string; qty: number }[];
      lost: { name: string; qty: number }[];
    };
  };
}

export interface BattleResponse {
  state: BattleResponseState;
  events: BattleEvent[]; // 仅含 seq > sinceSeq 的增量
}

// ---------- 背包（与 server/src/routes/inventory.ts toBagItemView、game/equipment.ts 对齐） ----------

/** 运行时装备栏位（server EQUIP_SLOT_CODES：静态 ring 拆 ring1/ring2，共 14） */
export type EquipSlotCode =
  | "main_hand" | "off_hand" | "head" | "shoulder" | "chest" | "hands" | "waist"
  | "legs" | "feet" | "wrist" | "ring1" | "ring2" | "neck" | "cloak";

/** 装备子对象（仅 kind=equipment 的行携带；字段照 server 静态装备分支） */
export interface BagItemEquip {
  slot: string; // 静态部位（ring 拆 ring1/ring2 由服务端 planEquip 处理）
  equipType: string;
  hands: 1 | 2;
  levelReq: number;
  durabilityMax: number; // 耐久上限（详情窗「耐久 x/y」的分母）
  dmgMin?: number;
  dmgMax?: number;
  intervalMs?: number;
  defBonus?: number;
  bonuses: Partial<Record<"vit" | "str" | "agi" | "intel" | "spr" | "atk" | "hp" | "sp", number>>;
}

/** 绑定状态（server bind_state 列；应用层兜底未知值 → bind_on_equip）：装备后绑定=可交易地基，已绑定=不可交易 */
export type BindState = "bind_on_equip" | "bound";

/** 背包/已穿行视图（inventory.ts toBagItemView 输出；静态漂移兜底：name=code、quality=""） */
export interface BagItemView {
  inventoryId: number;
  itemCode: string;
  slotIndex: number | null; // null=已穿戴（character_equipment 引用的行）
  quantity: number;
  durability: number | null;
  bindState: BindState; // 绑定状态透传（消耗品/材料不展示，仅装备详情卡显示）
  name: string;
  quality: string; // 仅装备有 gray/green/blue/purple/orange，其余为 ""
  sprite: string;
  desc: string; // 静态描述文案（未知 code 兜底为空串）
  kind: "consumable" | "material" | "equipment";
  stackMax: number;
  unit: string; // 数量单位（静态 unit 全量携带；未知 code 服务端兜底「个」）
  equip?: BagItemEquip; // JSON 序列化时 undefined 字段省略
}

/** 装备加成汇总（equipmentBonusesOf 原样输出；dmgMin/dmgMax/intervalMs null=无有效武器） */
export interface EquipmentBonusesView {
  vit: number;
  str: number;
  agi: number;
  intel: number;
  spr: number;
  hp: number;
  sp: number;
  atk: number;
  def: number;
  dmgMin: number | null;
  dmgMax: number | null;
  intervalMs: number | null;
}

/** 宠物窗战斗属性块（GET /api/inventory combat；engine.playerCombatOf 同源口径：无武器徒手兜底、暴击 BASE_CRIT） */
export interface CombatStatsView {
  dmgMin: number;
  dmgMax: number;
  intervalMs: number;
  atk: number;
  def: number;
  critRate: number;
}

/** GET /api/inventory 响应 */
export interface InventoryView {
  copper: number;
  bag: BagItemView[]; // 仅未穿戴行，slotIndex 升序
  equipment: Record<EquipSlotCode, BagItemView | null>; // 恒 14 键，空部位 null
  bonuses: EquipmentBonusesView;
  combat: CombatStatsView; // 与战斗引擎开战并装同源（勿在面板复刻公式）
}

/** POST /api/inventory/equip 响应（两段式确认）：ok=已穿上；needBindConfirm=「装备后绑定」待确认（未落库） */
export type EquipResult =
  | { ok: boolean }
  | { needBindConfirm: true; name: string };

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
  // 背包视图：铜币 + 背包行（slotIndex 升序）+ 14 栏位装备 + 加成汇总
  inventory: () => request<InventoryView>("/api/inventory"),
  // 穿戴（两段式确认）：不带 confirmBind=第一击，「装备后绑定」装备回 needBindConfirm（不落库）；
  // confirmBind=true=第二击（聊天区「确认装备」），穿戴成功并落 bound。
  // 替换/双手联动由服务端 planEquip 处理；400 message（等级/职业/背包空间不足）直接可提示
  equip: (inventoryId: number, confirmBind?: boolean) =>
    request<EquipResult>("/api/inventory/equip", {
      method: "POST",
      body: JSON.stringify(confirmBind === undefined ? { inventoryId } : { inventoryId, confirmBind }),
    }),
  // 卸下：包满 400「背包已满」
  unequip: (slotCode: EquipSlotCode) =>
    request<{ ok: boolean }>("/api/inventory/unequip", {
      method: "POST",
      body: JSON.stringify({ slotCode }),
    }),
  // 用药：战斗中 409；非消耗品 400；成功返回并入恢复后的 hp/sp
  useItem: (inventoryId: number) =>
    request<{ hp: number; sp: number }>("/api/inventory/use", {
      method: "POST",
      body: JSON.stringify({ inventoryId }),
    }),
  // 丢弃：quantity 缺省=整堆；已穿戴 400
  discard: (inventoryId: number, quantity?: number) =>
    request<{ ok: boolean }>("/api/inventory/discard", {
      method: "POST",
      body: JSON.stringify(quantity === undefined ? { inventoryId } : { inventoryId, quantity }),
    }),
};

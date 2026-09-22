# 切片 5：掉落 + 背包 + 穿脱 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通「打怪 → 按掉落表掷掉落（含铜币）→ 物品入 300 格背包 → 装备穿脱改变战斗属性 → 死亡装备耐久 -5%」闭环，含前端背包/装备栏面板与结算掉落展示。

**Architecture:** 静态数据新增 `items.json`（kind 判别 union：消耗品/材料/装备）并给 `monsters.json` 每怪内嵌 `drops`；掉落判定续用战斗种子 RNG（`advance` 尾部已回写 `state.seed`，结算时 `createRng(state.seed)` 续流）；入包/穿戴/替换为纯函数（`game/inventory.ts`）+ 事务路由（`routes/inventory.ts`，统一先锁角色行）；装备加成经 `game/equipment.ts` 汇总后在 `battle.ts` 开战组装时并入 Combatant（武器伤害区间替换徒手 1~3、武器攻速覆盖职业默认）；结算 victory 分支补铜币入账+掉落入包，defeat 分支全身装备耐久 -5%。

**Tech Stack:** Fastify 5 + mysql2 手写 SQL + zod；Vue 3 SFC（GameShell 挂 InventoryPanel）；Vitest（unit + db 两档）。

**Spec:** `docs/superpowers/specs/2026-09-22-drops-inventory-design.md`（本计划从规格出发，两份一起读）

---

## Global Constraints

- 仓库语言中文：注释/文案/commit message 全中文，commit 格式 `type: 中文描述`。
- server import 必须显式带 `.ts` 扩展名（Node 原生 TS 运行器）。
- 静态数据校验失败**拒绝启动**（共识 #4）；MySQL 只存运行时状态，运行时表引用静态数据一律 VARCHAR code。
- 全部改背包/结算路由先 `SELECT ... FOR UPDATE` 角色行（与结算临界区互斥）；无新表，不建新迁移。
- 背包 300 格（`slot_index` 0~299）；可堆叠物 stackMax 99，装备 qty 恒 1 独立行。
- `rules.ts` 派生函数签名**不动**（无装备基准）；装备加成在组装处相加；`characters.hp/sp` 列恒存「基础上限内」的当前值（装备加成只在战斗快照与展示上限生效——这样脱装备永不溢出）。
- 品质色（前端常量，原版口径紫 `#8a2be2`）：灰 `#9c9c9c` / 绿 `#4caf50` / 蓝 `#2f7bd8` / 紫 `#8a2be2` / 橙 `#ff8c00`。
- UI 基准 1400×832；零 CDN 零运行时联网。

## Review Focus（规格暗示但常规测试不覆盖的输入类）

1. **静态漂移**：`character_inventory.item_code`/装备位引用的物品从 items.json 删除后，`equipmentBonusesOf` 与 `GET /api/inventory` 不得崩溃——按「跳过该件/兜底文案」处理（Task 4/7 各有测试钉住）。
2. **旧战斗快照回放**：切片 4 遗留的 `battles.state` 无 `dmgMin/dmgMax` 字段，引擎必须 `?? UNARMED` 兜底且时间线不变（Task 5 测试钉住）。
3. **耐久 0 的装备**：仍占部位、仍显示在装备栏，但全部加成失效含武器区间（武器失效回徒手 1~3 与职业默认攻速）（Task 4 测试钉住）。
4. **qty 边界**：`qtyMin === qtyMax` 也必须掷 qty（RNG 序列稳定性）；堆叠跨多堆填满（Task 2/3 测试钉住）。
5. **并发穿脱 vs 结算**：无法在 db 测试稳定模拟并发，实现者必须保持「所有背包写路径先锁角色行」的纪律；code review 时逐路由核对（Task 6/7 步骤内写明）。

---

### Task 1: items.json + monsters.json drops + schema 校验 + loader

**Files:**
- Create: `server/data/items.json`
- Modify: `server/data/monsters.json`（5 怪各加 `drops`，数值见下表）
- Modify: `server/src/data/schemas.ts`（ItemSchema union、MonsterDropsSchema）
- Modify: `server/src/data/loader.ts`（itemIndex、validateCrossRefs 扩展掉落引用校验）
- Test: `server/test/unit/data.test.ts`（扩展）

**Interfaces:**
- Produces: `itemIndex(): Map<string, Item>`；类型 `Item`（=`ConsumableItem | MaterialItem | EquipmentItem`）、`EquipmentItem`（含 `quality/slot/equipType/profession/hands/levelReq/durabilityMax/dmgMin?/dmgMax?/intervalMs?/defBonus?/bonuses`）、`MonsterDrops`。后续所有任务经 loader 消费。
- Produces: `SLOT_CODES`（静态 13 部位，含 `ring`）。

- [ ] **Step 1: 写失败单测**（追加到 `server/test/unit/data.test.ts`）

```ts
import { loadItems, itemIndex, validateCrossRefs } from "../../src/data/loader.ts";
import { ItemsFileSchema, MonstersFileSchema } from "../../src/data/schemas.ts";

describe("items.json 静态物品", () => {
  it("通过 zod 校验且 code 唯一", () => {
    const f = loadItems();
    expect(f.items.length).toBeGreaterThanOrEqual(20);
    expect(ItemsFileSchema.safeParse(f).success).toBe(true);
  });
  it("装备 kind 判别：武器必带伤害区间与攻速，防具无伤害字段", () => {
    const items = itemIndex();
    const w = items.get("bubingjian")!;
    expect(w.kind).toBe("equipment");
    if (w.kind === "equipment") {
      expect(w.dmgMin).toBe(7);
      expect(w.dmgMax).toBe(9);
      expect(w.intervalMs).toBe(2100);
      expect(w.quality).toBe("green");
    }
    const a = items.get("yama_waiyi")!;
    if (a.kind === "equipment") expect(a.dmgMin).toBeUndefined();
  });
  it("消耗品 effect 至少一项", () => {
    const y = itemIndex().get("xiaoxing_buxueji")!;
    expect(y.kind).toBe("consumable");
    if (y.kind === "consumable") expect(y.effect.hp).toBe(50);
  });
  it("考据抽查：步兵剑 7-9/速度2.1/耐久13/等级4；能量之卷刃剑带攻击+2；冰风靴体力+2智力+2", () => {
    const idx = itemIndex();
    const b = idx.get("bubingjian")!;
    if (b.kind === "equipment") {
      expect([b.dmgMin, b.dmgMax, b.intervalMs, b.durabilityMax, b.levelReq]).toEqual([7, 9, 2100, 13, 4]);
      expect(b.profession).toBe("warrior");
    }
    const e = idx.get("nengliang_juanrenjian")!;
    if (e.kind === "equipment") expect(e.bonuses.atk).toBe(2);
    const i = idx.get("bingfeng_xue")!;
    if (i.kind === "equipment") expect(i.bonuses).toMatchObject({ vit: 2, intel: 2 });
  });
  it("非法装备（武器缺伤害区间）被拒绝", () => {
    const bad = { items: [{ code: "x", name: "断剑", sprite: "/i.png", desc: "", kind: "equipment",
      quality: "gray", slot: "main_hand", equipType: "剑", profession: "warrior",
      levelReq: 1, durabilityMax: 10, hands: 1 }] };
    expect(ItemsFileSchema.safeParse(bad).success).toBe(false);
  });
  it("怪物 drops 引用不存在的物品时 validateCrossRefs 抛错", () => {
    const monsters = MonstersFileSchema.parse({ monsters: [
      { code: "m1", name: "怪", level: 1, sprite: "/m.gif", hpMin: 1, hpMax: 2, atkMin: 0, atkMax: 1,
        def: 0, dodgeRate: 0, critRate: 0, intervalMs: 1000, exp: 1,
        drops: { copper: [1, 2], items: [{ item: "no_such_item", chance: 0.5 }] } },
    ]});
    expect(() => validateCrossRefs(new Map(), new Map(monsters.monsters.map(m => [m.code, m])))).toThrow(/no_such_item/);
  });
  it("现有 monsters.json 每只怪都配了 drops", () => {
    for (const m of loadMonsters().monsters) expect(m.drops, m.code).toBeDefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter maoyouji-server test`
Expected: FAIL（`loadItems` 不存在）

- [ ] **Step 3: 写 schemas.ts 扩展**

```ts
// ---------- 物品（切片 5：消耗品/材料/装备统一 code 空间，kind 判别） ----------

export const QUALITY_CODES = ["gray", "green", "blue", "purple", "orange"] as const;

/** 静态装备部位（13）。运行时戒指拆 ring1/ring2 两个栏位（见 game/inventory.ts EQUIP_SLOT_CODES） */
export const SLOT_CODES = [
  "main_hand", "off_hand", "head", "shoulder", "chest", "hands", "waist",
  "legs", "feet", "wrist", "ring", "neck", "cloak",
] as const;

const itemBase = {
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(32),
  sprite: z.string().min(1),
  desc: z.string().max(200),
};

const statBonuses = z.strictObject({
  vit: z.number().int().min(0).max(100).optional(),
  str: z.number().int().min(0).max(100).optional(),
  agi: z.number().int().min(0).max(100).optional(),
  intel: z.number().int().min(0).max(100).optional(),
  spr: z.number().int().min(0).max(100).optional(),
  /** 原版「攻击:+N」词条（蓝宝书口径），开战时直接并入 atk */
  atk: z.number().int().min(0).max(999).optional(),
  hp: z.number().int().min(0).max(9999).optional(),
  sp: z.number().int().min(0).max(9999).optional(),
});

export const ConsumableItemSchema = z.strictObject({
  ...itemBase,
  kind: z.literal("consumable"),
  /** 使用效果（至少一项非零） */
  effect: z.strictObject({ hp: z.number().int().min(0).optional(), sp: z.number().int().min(0).optional() })
    .refine((e) => (e.hp ?? 0) + (e.sp ?? 0) > 0, { message: "消耗品 effect 至少一项" }),
  stackMax: z.number().int().min(1).max(99).default(99),
});

export const MaterialItemSchema = z.strictObject({
  ...itemBase,
  kind: z.literal("material"),
  stackMax: z.number().int().min(1).max(99).default(99),
});

export const EquipmentItemSchema = z.strictObject({
  ...itemBase,
  kind: z.literal("equipment"),
  quality: z.enum(QUALITY_CODES),
  slot: z.enum(SLOT_CODES),
  equipType: z.string().min(1).max(16),
  /** 职业限定（武器+盾牌口径：战士剑/盾牌、法师魔杖）；null=通用（防具饰品） */
  profession: z.enum(["warrior", "mage"]).nullable(),
  levelReq: z.number().int().min(1).max(90),
  durabilityMax: z.number().int().min(1).max(999),
  /** 双手武器占副手；默认 1 */
  hands: z.union([z.literal(1), z.literal(2)]).default(1),
  // —— 武器字段（main_hand 必带；其余部位带即拒绝）——
  dmgMin: z.number().int().min(0).optional(),
  dmgMax: z.number().int().min(0).optional(),
  /** 武器攻速（ms/次），覆盖职业默认 */
  intervalMs: z.number().int().min(500).max(10000).optional(),
  // —— 防具字段 ——
  defBonus: z.number().int().min(0).optional(),
  bonuses: statBonuses.default({}),
})
  .refine((e) => e.slot !== "main_hand" || (e.dmgMin !== undefined && e.dmgMax !== undefined && e.intervalMs !== undefined),
    { message: "武器必带 dmgMin/dmgMax/intervalMs" })
  .refine((e) => e.slot === "main_hand" || (e.dmgMin === undefined && e.dmgMax === undefined && e.intervalMs === undefined),
    { message: "非武器不得带伤害/攻速字段" })
  .refine((e) => e.dmgMin === undefined || e.dmgMax === undefined || e.dmgMin <= e.dmgMax,
    { message: "dmgMin 不能大于 dmgMax" })
  .refine((e) => e.slot !== "off_hand" || e.hands === 1, { message: "副手不得是双手" })
  .refine((e) => e.slot === "main_hand" || e.slot === "off_hand" || e.profession === null, { message: "职业限定仅用于武器与盾牌（蓝宝书：盾牌战士专用）" });

export const ItemSchema = z.discriminatedUnion("kind", [
  ConsumableItemSchema,
  MaterialItemSchema,
  EquipmentItemSchema,
]);

export const ItemsFileSchema = z
  .object({ items: z.array(ItemSchema).min(1) })
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    for (const it of f.items) {
      if (seen.has(it.code)) ctx.addIssue({ code: "custom", message: `物品 code 重复：${it.code}` });
      seen.add(it.code);
    }
  });

export type ConsumableItem = z.infer<typeof ConsumableItemSchema>;
export type MaterialItem = z.infer<typeof MaterialItemSchema>;
export type EquipmentItem = z.infer<typeof EquipmentItemSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type ItemsFile = z.infer<typeof ItemsFileSchema>;

/** 怪物掉落表（每次击杀：copper 区间掷一次 + items 逐条独立概率） */
const MonsterDropEntrySchema = z.object({
  item: z.string().min(1).max(64),
  chance: z.number().gt(0).le(1),
  qtyMin: z.number().int().min(1).max(99).default(1),
  qtyMax: z.number().int().min(1).max(99).default(1),
}).refine((e) => e.qtyMin <= e.qtyMax, { message: "qtyMin 不能大于 qtyMax" });

export const MonsterDropsSchema = z.object({
  copper: z.tuple([z.number().int().min(0).max(999999), z.number().int().min(0).max(999999)])
    .refine(([a, b]) => a <= b, { message: "copper 区间 min 不能大于 max" }),
  items: z.array(MonsterDropEntrySchema),
});

export type MonsterDrops = z.infer<typeof MonsterDropsSchema>;
```

`MonsterSchema` 加一行字段：`drops: MonsterDropsSchema.optional(),`。

- [ ] **Step 4: 写 loader.ts 扩展**（风格照 loadMonsters/monsterIndex）

```ts
const DEFAULT_ITEMS_PATH = new URL("../../data/items.json", import.meta.url);

/** 读取并校验静态物品数据；校验失败抛错（共识 #4：拒绝启动） */
export function loadItems(path: URL | string = DEFAULT_ITEMS_PATH): ItemsFile {
  return ItemsFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

let itemCache: Map<string, Item> | null = null;

/** 物品 code → 物品 索引（模块级缓存） */
export function itemIndex(): Map<string, Item> {
  if (!itemCache) {
    itemCache = new Map(loadItems().items.map((i) => [i.code, i]));
  }
  return itemCache;
}
```

`validateCrossRefs` 追加第三参（带默认值，既有调用不破）：

```ts
export function validateCrossRefs(
  maps: Map<string, GameMap> = mapIndex(),
  monsters: Map<string, Monster> = monsterIndex(),
  items: Map<string, Item> = itemIndex(),
): void {
  // ……既有 spawns 校验不动……
  // 掉落表引用的物品必须存在（schema 层做不了跨文件校验，与 spawns 同理放 loader）
  for (const m of monsters.values()) {
    for (const d of m.drops?.items ?? []) {
      if (!items.has(d.item)) {
        throw new Error(`怪物 ${m.code} 的 drops 引用不存在的物品：${d.item}`);
      }
    }
  }
}
```

注意 import：`ItemsFileSchema/ItemSchema/ItemsFile/Item/MonsterDropsSchema` 及类型加入 schemas.ts 的 import 列表；`loadMonsters` 也要在本文件里被 import（data.test.ts 用）。

- [ ] **Step 5: 写 server/data/items.json**（**全部数值照抄蓝宝书第二篇考据**，来源 `docs/猫游记蓝宝书.doc`「第二篇：装备属性及出处」与 1-3 楼怪物掉落清单，antiword 提取核对；仅两处系统性映射，规则锁定）：
  - **防御缩放**：MVP 战斗公式 `roll + atk − def` 与原版防御尺度不同，`defBonus = ceil(原版防御 ÷ 25)`（布帽+10→1、军用盾+135→6、普通盾+189→8）。伤害/速度/耐久/等级/五维/攻击加成照抄。
  - **品质映射**：原版`[蓝]`标注 → `blue`；带词缀前缀（野熊之/能量之/力量之…）→ `green`；无标注基础装 → `gray`。
  - 魔杖伤害的火/圣/暗属性 MVP 忽略只取数值；「命中:+N」「闪避:+N」词条 MVP 不做；耐久「15 / 16」取上限 16（生成满耐久）；原版未载耐久的饰品手配 10 并注记。
  - 原版 1~10 级无真双手武器（枪类最低 20 级）——items.json 不含 hands=2 物品，双手规则由 Task 3 合成夹具单测验证。

```json
{
  "items": [
    { "code": "xiaoxing_buxueji", "name": "小型补血剂", "sprite": "/items/xiaoxing_buxueji.png", "desc": "猫隐村药铺最常见的伤药（回复量原版未详载，MVP 手配 50）。", "kind": "consumable", "effect": { "hp": 50 }, "stackMax": 99 },
    { "code": "xiao_mofaji", "name": "小魔法剂", "sprite": "/items/xiao_mofaji.png", "desc": "泛着微光的蓝色药剂（回复量原版未详载，MVP 手配 30）。", "kind": "consumable", "effect": { "sp": 30 }, "stackMax": 99 },

    { "code": "kunchong_waike", "name": "昆虫外壳", "sprite": "/items/kunchong_waike.png", "desc": "绿毛虫蜕下的外壳，轻而坚韧。", "kind": "material", "stackMax": 99 },
    { "code": "pingguo", "name": "苹果", "sprite": "/items/pingguo.png", "desc": "草原上随处可见的红苹果，小怪物们的心头好。", "kind": "material", "stackMax": 99 },
    { "code": "jiaozhuazi", "name": "鸡爪子", "sprite": "/items/jiaozhuazi.png", "desc": "机警小鸡掉落的爪子，据说卤过很好吃。", "kind": "material", "stackMax": 99 },
    { "code": "jitui", "name": "鸡腿", "sprite": "/items/jitui.png", "desc": "肥嫩的鸡腿，冒险者干粮首选。", "kind": "material", "stackMax": 99 },
    { "code": "hongse_baozi", "name": "红色孢子", "sprite": "/items/hongse_baozi.png", "desc": "红蘑菇飘散的红色孢子，随风远行。", "kind": "material", "stackMax": 99 },
    { "code": "xiezi_weiba", "name": "蝎子尾巴", "sprite": "/items/xiezi_weiba.png", "desc": "草原蝎的尾巴，毒钩犹在，可入药。", "kind": "material", "stackMax": 99 },
    { "code": "xiezi_zhi_qian", "name": "蝎子之钳", "sprite": "/items/xiezi_zhi_qian.png", "desc": "草原蝎的大钳，坚硬无比。", "kind": "material", "stackMax": 99 },

    { "code": "nongfuzhijian", "name": "农夫之剑", "sprite": "/items/nongfuzhijian.png", "desc": "出处：牧野草原——波力。右手，剑，2-4 伤害，速度 2.6，耐久 10/10，装备需要等级 1。", "kind": "equipment", "quality": "gray", "slot": "main_hand", "equipType": "剑", "profession": "warrior", "levelReq": 1, "durabilityMax": 10, "hands": 1, "dmgMin": 2, "dmgMax": 4, "intervalMs": 2600 },
    { "code": "bubingjian", "name": "步兵剑", "sprite": "/items/bubingjian.png", "desc": "出处：牧野草原——草原蝎。右手，剑，7-9 伤害，速度 2.1，每秒伤害 3.8，耐久 13/13，装备需要等级 4。", "kind": "equipment", "quality": "green", "slot": "main_hand", "equipType": "剑", "profession": "warrior", "levelReq": 4, "durabilityMax": 13, "hands": 1, "dmgMin": 7, "dmgMax": 9, "intervalMs": 2100 },
    { "code": "nengliang_juanrenjian", "name": "能量之卷刃剑", "sprite": "/items/nengliang_juanrenjian.png", "desc": "出处：牧野草原——绿毛虫。右手，剑，10-14 伤害，速度 2.1，每秒伤害 5.5，耐久 14/17，攻击:+2，装备需要等级 5。", "kind": "equipment", "quality": "green", "slot": "main_hand", "equipType": "剑", "profession": "warrior", "levelReq": 5, "durabilityMax": 17, "hands": 1, "dmgMin": 10, "dmgMax": 14, "intervalMs": 2100, "bonuses": { "atk": 2 } },
    { "code": "liliang_juanrenjian", "name": "力量之卷刃剑", "sprite": "/items/liliang_juanrenjian.png", "desc": "出处：北牧野草原——红蘑菇。右手，剑，10-14 伤害，速度 2.1，每秒伤害 5.5，耐久 17/17，力量:+1，装备需要等级 5。", "kind": "equipment", "quality": "green", "slot": "main_hand", "equipType": "剑", "profession": "warrior", "levelReq": 5, "durabilityMax": 17, "hands": 1, "dmgMin": 10, "dmgMax": 14, "intervalMs": 2100, "bonuses": { "str": 1 } },
    { "code": "doushi_dujian", "name": "斗士短剑", "sprite": "/items/doushi_dujian.png", "desc": "出处：牧野草原——机警小鸡。右手，剑，13-17 伤害，速度 2.2，每秒伤害 6.8，耐久 17/17，装备需要等级 10。", "kind": "equipment", "quality": "green", "slot": "main_hand", "equipType": "剑", "profession": "warrior", "levelReq": 10, "durabilityMax": 17, "hands": 1, "dmgMin": 13, "dmgMax": 17, "intervalMs": 2200 },
    { "code": "xiangmuzhang", "name": "橡木杖", "sprite": "/items/xiangmuzhang.png", "desc": "出处：幼儿园——盗虫卵。右手，魔杖，1-3 火焰伤害（属性 MVP 忽略），速度 1.9，每秒伤害 1.1，耐久 10/10，装备需要等级 1。", "kind": "equipment", "quality": "gray", "slot": "main_hand", "equipType": "魔杖", "profession": "mage", "levelReq": 1, "durabilityMax": 10, "hands": 1, "dmgMin": 1, "dmgMax": 3, "intervalMs": 1900 },
    { "code": "ciji_mofazhang", "name": "次级魔法杖", "sprite": "/items/ciji_mofazhang.png", "desc": "出处：北牧野草原——野兔、红蘑菇、草原巨蝎、苍蝇。右手，魔杖，3-5 神圣伤害，速度 1.5，每秒伤害 2.8，耐久 14/14，装备需要等级 5。", "kind": "equipment", "quality": "gray", "slot": "main_hand", "equipType": "魔杖", "profession": "mage", "levelReq": 5, "durabilityMax": 14, "hands": 1, "dmgMin": 3, "dmgMax": 5, "intervalMs": 1500 },
    { "code": "huoyan_mozhang", "name": "火焰魔杖", "sprite": "/items/huoyan_mozhang.png", "desc": "出处：北牧野草原——野兔。右手，魔杖，5-7 火焰伤害，速度 1.5，每秒伤害 4.3，耐久 19/19，装备需要等级 7。", "kind": "equipment", "quality": "green", "slot": "main_hand", "equipType": "魔杖", "profession": "mage", "levelReq": 7, "durabilityMax": 19, "hands": 1, "dmgMin": 5, "dmgMax": 7, "intervalMs": 1500 },
    { "code": "anying_mozhang", "name": "暗影魔杖", "sprite": "/items/anying_mozhang.png", "desc": "出处：万马草原——白波力、草鸡、白老鼠。右手，魔杖，6-8 暗影伤害，速度 1.4，每秒伤害 5.2，耐久 21/21，装备需要等级 9。", "kind": "equipment", "quality": "green", "slot": "main_hand", "equipType": "魔杖", "profession": "mage", "levelReq": 9, "durabilityMax": 21, "hands": 1, "dmgMin": 6, "dmgMax": 8, "intervalMs": 1400 },

    { "code": "xiaoqingdun", "name": "小轻盾", "sprite": "/items/xiaoqingdun.png", "desc": "出处：牧野草原——小鸡。左手，盾牌，防御:+112（映射 5），耐久 9/9，装备需要等级 3。", "kind": "equipment", "quality": "gray", "slot": "off_hand", "equipType": "盾牌", "profession": "warrior", "levelReq": 3, "durabilityMax": 9, "defBonus": 5 },
    { "code": "junyong_dunpai", "name": "军用盾牌", "sprite": "/items/junyong_dunpai.png", "desc": "出处：牧野草原——草原蝎。盾牌，防御:+135（映射 6），耐久 10/10，装备需要等级 4。", "kind": "equipment", "quality": "gray", "slot": "off_hand", "equipType": "盾牌", "profession": "warrior", "levelReq": 4, "durabilityMax": 10, "defBonus": 6 },
    { "code": "minbing_dunpai", "name": "民兵盾牌", "sprite": "/items/minbing_dunpai.png", "desc": "出处：牧野草原——波力。左手，盾牌，防御:+161（映射 7），耐久 11/11，装备需要等级 5。", "kind": "equipment", "quality": "gray", "slot": "off_hand", "equipType": "盾牌", "profession": "warrior", "levelReq": 5, "durabilityMax": 11, "defBonus": 7 },
    { "code": "putong_dunpai", "name": "普通盾牌", "sprite": "/items/putong_dunpai.png", "desc": "出处：牧野草原——绿毛虫。左手，盾牌，防御:+189（映射 8），耐久 11/11，装备需要等级 6。", "kind": "equipment", "quality": "gray", "slot": "off_hand", "equipType": "盾牌", "profession": "warrior", "levelReq": 6, "durabilityMax": 11, "defBonus": 8 },
    { "code": "yexiong_bubing_dunpai", "name": "野熊之步兵盾牌", "sprite": "/items/yexiong_bubing_dunpai.png", "desc": "出处：牧野草原——草原蝎。左手，盾牌，力量:+1，体力:+1，防御:+207（映射 9），装备需要等级 6。", "kind": "equipment", "quality": "green", "slot": "off_hand", "equipType": "盾牌", "profession": "warrior", "levelReq": 6, "durabilityMax": 14, "defBonus": 9, "bonuses": { "str": 1, "vit": 1 } },

    { "code": "buzhi_ruanmao", "name": "布质软帽", "sprite": "/items/buzhi_ruanmao.png", "desc": "出处：牧野草原——绿毛虫。头，布甲，耐久 30/30，智力:+2，防御:+10（映射 1），装备需要等级 1。", "kind": "equipment", "quality": "blue", "slot": "head", "equipType": "布甲", "profession": null, "levelReq": 1, "durabilityMax": 30, "defBonus": 1, "bonuses": { "intel": 2 } },
    { "code": "yama_waiyi", "name": "亚麻外衣", "sprite": "/items/yama_waiyi.png", "desc": "出处：幼儿园——葡萄藤、知鸟；牧野草原——绿毛虫。胸，布甲，耐久 19/19，防御:+15（映射 1），装备需要等级 1。", "kind": "equipment", "quality": "gray", "slot": "chest", "equipType": "布甲", "profession": null, "levelReq": 1, "durabilityMax": 19, "defBonus": 1 },
    { "code": "yuanxingzhe_changxue", "name": "远行者长靴", "sprite": "/items/yuanxingzhe_changxue.png", "desc": "出处：北牧野草原——红蘑菇；牧野草原——波力。脚，锁甲，耐久 30/30，体力:+2，防御:+44（映射 2），装备需要等级 1。", "kind": "equipment", "quality": "blue", "slot": "feet", "equipType": "锁甲", "profession": null, "levelReq": 1, "durabilityMax": 30, "defBonus": 2, "bonuses": { "vit": 2 } },
    { "code": "yama_duanbu", "name": "亚麻短裤", "sprite": "/items/yama_duanbu.png", "desc": "出处：幼儿园——捕蝇草；牧野草原——波力、绿毛虫。腿，布甲，耐久 15/16（取上限），防御:+12（映射 1），装备需要等级 2。", "kind": "equipment", "quality": "gray", "slot": "legs", "equipType": "布甲", "profession": null, "levelReq": 2, "durabilityMax": 16, "defBonus": 1 },
    { "code": "yuanzhi_shoutao", "name": "园艺手套", "sprite": "/items/yuanzhi_shoutao.png", "desc": "出处：幼儿园——太阳花；牧野草原——波力。手套，布甲，耐久 18/18，防御:+10（映射 1），装备需要等级 4。", "kind": "equipment", "quality": "gray", "slot": "hands", "equipType": "布甲", "profession": null, "levelReq": 4, "durabilityMax": 18, "defBonus": 1 },
    { "code": "yama_changpao", "name": "亚麻长袍", "sprite": "/items/yama_changpao.png", "desc": "出处：牧野草原——草原蝎。胸，布甲，耐久 32/32，智力:+1，防御:+19（映射 1），装备需要等级 5。", "kind": "equipment", "quality": "green", "slot": "chest", "equipType": "布甲", "profession": null, "levelReq": 5, "durabilityMax": 32, "defBonus": 1, "bonuses": { "intel": 1 } },
    { "code": "zhenzhi_waiyi", "name": "针织外衣", "sprite": "/items/zhenzhi_waiyi.png", "desc": "出处：牧野草原——黑蘑菇。胸，布甲，耐久 26/26，防御:+18（映射 1），装备需要等级 5。", "kind": "equipment", "quality": "gray", "slot": "chest", "equipType": "布甲", "profession": null, "levelReq": 5, "durabilityMax": 26, "defBonus": 1 },
    { "code": "zhuzhu_shoutao", "name": "珠串手套", "sprite": "/items/zhuzhu_shoutao.png", "desc": "出处：牧野草原——黑蘑菇、草原蝎。手套，布甲，耐久 19/19，防御:+11（映射 1），装备需要等级 5。", "kind": "equipment", "quality": "gray", "slot": "hands", "equipType": "布甲", "profession": null, "levelReq": 5, "durabilityMax": 19, "defBonus": 1 },
    { "code": "zhenzhi_duanbu", "name": "针织短裤", "sprite": "/items/zhenzhi_duanbu.png", "desc": "出处：牧野草原——绿毛虫。腿，布甲，耐久 19/19，防御:+16（映射 1），装备需要等级 5。", "kind": "equipment", "quality": "gray", "slot": "legs", "equipType": "布甲", "profession": null, "levelReq": 5, "durabilityMax": 19, "defBonus": 1 },
    { "code": "linghou_zhuzhu_waitao", "name": "灵猴之珠串外套", "sprite": "/items/linghou_zhuzhu_waitao.png", "desc": "出处：牧野草原——小鸡、机警小鸡。胸，布甲，耐久 34/34，敏捷:+1，体力:+1，防御:+21（映射 1），装备需要等级 6。", "kind": "equipment", "quality": "green", "slot": "chest", "equipType": "布甲", "profession": null, "levelReq": 6, "durabilityMax": 34, "defBonus": 1, "bonuses": { "agi": 1, "vit": 1 } },
    { "code": "bingfeng_xue", "name": "冰风靴", "sprite": "/items/bingfeng_xue.png", "desc": "出处：牧野草原——草原蝎。脚，布甲，耐久 45/45，体力:+2，智力:+2，防御:+15（映射 1），装备需要等级 7。", "kind": "equipment", "quality": "blue", "slot": "feet", "equipType": "布甲", "profession": null, "levelReq": 7, "durabilityMax": 45, "defBonus": 1, "bonuses": { "vit": 2, "intel": 2 } },
    { "code": "bingling_jiezhi", "name": "冰灵戒指", "sprite": "/items/bingling_jiezhi.png", "desc": "出处：万马草原——白波力。手指，戒指，智力:+3，装备需要等级 7（原版未载耐久，MVP 手配 10）。", "kind": "equipment", "quality": "blue", "slot": "ring", "equipType": "戒指", "profession": null, "levelReq": 7, "durabilityMax": 10, "bonuses": { "intel": 3 } }
  ]
}
```

- [ ] **Step 6: monsters.json 5 怪加 drops**（蓝宝书掉落清单考据；chance/qty/copper 为 MVP 手配平衡值，物品种类按原版）

| 怪 code | copper | items（item / chance / qty） |
|---|---|---|
| paopao | [5,12] | xiaoxing_buxueji 0.12；xiangmuzhang 0.05（泡泡原版不在牧野草原、无掉落记载，物品池自配——橡木杖为法师第一件武器） |
| lvmaochong | [4,12] | kunchong_waike 0.5 [1,2]；pingguo 0.3；buzhi_ruanmao 0.03；putong_dunpai 0.02；nengliang_juanrenjian 0.02；zhenzhi_duanbu 0.05；yama_waiyi 0.05；nongfuzhijian 0.05（农夫之剑原版出处波力不在池内，MVP 手配——战士第一件武器） |
| xiaoji | [6,15] | jiaozhuazi 0.4 [1,2]；jitui 0.25 [1,2]；xiaoqingdun 0.03；linghou_zhuzhu_waitao 0.03；yama_duanbu 0.05；yama_waiyi 0.05；xiaoxing_buxueji 0.12 |
| hongmogu | [8,20] | hongse_baozi 0.5 [1,2]；xiao_mofaji 0.12；yuanxingzhe_changxue 0.02；liliang_juanrenjian 0.02；ciji_mofazhang 0.03；zhenzhi_waiyi 0.04 |
| caoyuanxie | [10,25] | xiezi_weiba 0.45 [1,2]；xiezi_zhi_qian 0.3；bubingjian 0.04；junyong_dunpai 0.03；bingfeng_xue 0.02；zhuzhu_shoutao 0.04；yama_changpao 0.04；yexiong_bubing_dunpai 0.02 |

（qty 默认 1 可省略；写不省略也行，保持文件内风格统一。民兵盾牌/园艺手套/斗士短剑/冰灵戒指/暗影魔杖/火焰魔杖不进本表——它们出自波力/太阳花/机警小鸡/万马草原怪，MVP 怪物池无来源，留作后续地图扩展；农夫之剑/橡木杖为新手第一件武器 MVP 手配进绿毛虫/泡泡掉落）

- [ ] **Step 7: 跑测试通过**

Run: `pnpm --filter maoyouji-server test`
Expected: PASS（既有用例不破——MonsterSchema 是加可选字段，向后兼容）

- [ ] **Step 8: Commit**

```bash
git add server/data/items.json server/data/monsters.json server/src/data/schemas.ts server/src/data/loader.ts server/test/unit/data.test.ts
git commit -m "feat: 物品装备静态数据与怪物掉落表及启动校验"
```

---

### Task 2: 掉落引擎 drops.ts（纯函数）

**Files:**
- Create: `server/src/game/drops.ts`
- Test: `server/test/unit/game/drops.test.ts`

**Interfaces:**
- Consumes: `Rng`（`game/rng.ts`）、`MonsterDrops`（Task 1）
- Produces:

```ts
export interface LootItem { itemCode: string; qty: number }
export interface LootResult { copper: number; items: LootItem[] }
/**
 * 掷一次击杀掉落。RNG 消耗顺序锁定（结算可复现性的契约，勿改）：
 * ① copper 恰好掷 1 次 int(copper[0], copper[1])（min===max 也掷）；
 * ② items 按表序逐条：先 1 掷 chance（next() < chance 即命中），命中后无论数量区间
 *    是否退化都再掷 1 次 qty（int(qtyMin, qtyMax)）。未命中只消耗 chance 那一掷。
 */
export function rollDrops(drops: MonsterDrops, rng: Rng): LootResult
```

- [ ] **Step 1: 写失败单测**（固定种子，断言确定性 + 顺序锁定）

```ts
import { describe, expect, it } from "vitest";
import { createRng } from "../../../src/game/rng.ts";
import { rollDrops } from "../../../src/game/drops.ts";

const DROPS = {
  copper: [5, 15] as [number, number],
  items: [
    { item: "a_material", chance: 1.0, qtyMin: 1, qtyMax: 2 },
    { item: "never", chance: 0.0000001, qtyMin: 1, qtyMax: 1 },
    { item: "b_sword", chance: 1.0, qtyMin: 1, qtyMax: 1 },
  ],
};

it("同种子结果完全一致", () => {
  expect(rollDrops(DROPS, createRng(42))).toEqual(rollDrops(DROPS, createRng(42)));
});

it("chance=1 全命中且 copper 在区间内", () => {
  const r = rollDrops(DROPS, createRng(7));
  expect(r.copper).toBeGreaterThanOrEqual(5);
  expect(r.copper).toBeLessThanOrEqual(15);
  expect(r.items.map((i) => i.itemCode)).toEqual(["a_material", "b_sword"]);
  expect(r.items[0].qty).toBeGreaterThanOrEqual(1);
  expect(r.items[0].qty).toBeLessThanOrEqual(2);
  expect(r.items[1].qty).toBe(1);
});

it("全 miss 时 items 为空但 copper 仍入账", () => {
  const r = rollDrops({ copper: [3, 3], items: [{ item: "x", chance: 0.0000001, qtyMin: 1, qtyMax: 1 }] }, createRng(1));
  expect(r.copper).toBe(3);
  expect(r.items).toEqual([]);
});

it("空掉落表返回零铜币", () => {
  expect(rollDrops({ copper: [0, 0], items: [] }, createRng(9))).toEqual({ copper: 0, items: [] });
});
```

- [ ] **Step 2: 跑测试确认失败**（模块不存在）

- [ ] **Step 3: 实现**（照 Interfaces 契约逐行写；`import type { Rng } from "./rng.ts"`、`import type { MonsterDrops } from "../data/schemas.ts"`）

- [ ] **Step 4: 跑测试通过**

Run: `pnpm --filter maoyouji-server test`

- [ ] **Step 5: Commit**

```bash
git add server/src/game/drops.ts server/test/unit/game/drops.test.ts
git commit -m "feat: 掉落判定纯函数rollDrops(固定种子顺序锁定)"
```

---

### Task 3: 背包纯函数 inventory.ts（入包 + 穿戴计划）

**Files:**
- Create: `server/src/game/inventory.ts`
- Test: `server/test/unit/game/inventory.test.ts`

**Interfaces:**
- Consumes: `Item`/`EquipmentItem`（Task 1）
- Produces（后续 Task 6/7 全部依赖，签名照抄）:

```ts
export const BAG_SLOTS = 300;

/** 运行时装备栏位（静态 ring 拆两栏，共 14） */
export const EQUIP_SLOT_CODES = [
  "main_hand", "off_hand", "head", "shoulder", "chest", "hands", "waist",
  "legs", "feet", "wrist", "ring1", "ring2", "neck", "cloak",
] as const;
export type EquipSlotCode = (typeof EQUIP_SLOT_CODES)[number];

/** 背包行（db 行的最小投影；slotIndex null=已穿戴不出现在 bag 参数里） */
export interface BagRow {
  id: number;
  itemCode: string;
  slotIndex: number;
  quantity: number;
}

/** stackMaxOf：物品 code → 堆叠上限（装备恒 1；未知 code 按 1 兜底=永不堆叠，静态漂移安全） */
export type StackMaxOf = (itemCode: string) => number;

export interface StackAdd { id: number; quantity: number }          // 往已有堆加量
export interface NewStack { itemCode: string; slotIndex: number; quantity: number; durabilityMax: number | null } // 开新格（装备 durabilityMax 非空供 db 层写 durability）
export interface LostItem { itemCode: string; qty: number }

/**
 * 把掉落依序装入背包：先填同码未满堆（从低 slot 行开始），再开最小空闲格。
 * 全程不改入参；放不下的进 lost（整段数量，不拆分丢弃——单次掉落条目要么全进要么全丢）。
 */
export function lootInto(
  bag: BagRow[],
  loot: LootItem[],
  stackMaxOf: StackMaxOf,
): { stackAdds: StackAdd[]; newStacks: NewStack[]; lost: LostItem[] }

/** 第一个空闲格（0 起）；满返回 null */
export function firstFreeSlot(bag: BagRow[]): number | null

export type EquipPlan =
  | { ok: true; targetSlot: EquipSlotCode; unequipInventoryIds: number[] }
  | { ok: false; reason: string };

/**
 * 穿戴计划（纯校验+替换联动，不落库）：
 * - 等级/职业不符 → 拒绝；耐久 0 允许穿（属性失效由 equipment.ts 处理）
 * - 目标部位占用 → 直接替换（旧装备回包）；戒指优先 ring1 再 ring2，都满替换 ring1
 * - 穿双手武器 → 副手占用则一并卸下；穿副手 → 主手是双手武器则一并卸下
 * - 不做背包空位校验：被穿装备必来自背包，离包即腾格，任何替换净占用 ≤ 0（规格决策 7
 *   二次修订「替换永可行」）；「腾格」由路由层执行顺序保证（先置 NULL 再给回包件分配格）
 */
export function planEquip(
  item: Item,
  inventoryId: number,
  character: { level: number; profession: "warrior" | "mage" },
  equipped: { slotCode: EquipSlotCode; inventoryId: number; itemCode: string }[],
  itemByCode: (code: string) => Item | undefined,
): EquipPlan
```

- [ ] **Step 1: 写失败单测**（关键用例全录，直接照抄）

```ts
import { describe, expect, it } from "vitest";
import { lootInto, firstFreeSlot, planEquip, BAG_SLOTS, type BagRow } from "../../../src/game/inventory.ts";
import type { Item } from "../../../src/data/schemas.ts";

const stackable = (code: string) => 99; // 测试里所有 code 都按可堆 99（装备用例单独给 1）
const eqOnly = (code: string) => (code.startsWith("eq_") ? 1 : 99);

function row(id: number, itemCode: string, slotIndex: number, quantity: number): BagRow {
  return { id, itemCode, slotIndex, quantity };
}

describe("lootInto", () => {
  it("空包新开格从 0 递增", () => {
    const r = lootInto([], [{ itemCode: "yao", qty: 3 }], stackable);
    expect(r.newStacks).toEqual([{ itemCode: "yao", slotIndex: 0, quantity: 3, durabilityMax: null }]);
    expect(r.stackAdds).toEqual([]);
    expect(r.lost).toEqual([]);
  });
  it("先堆后开格：同码未满堆加量，超出部分开新格", () => {
    const r = lootInto([row(1, "yao", 4, 98)], [{ itemCode: "yao", qty: 5 }], stackable);
    expect(r.stackAdds).toEqual([{ id: 1, quantity: 1 }]);
    expect(r.newStacks.map((n) => n.slotIndex)).toEqual([0]);
    expect(r.newStacks[0].quantity).toBe(4);
  });
  it("装备不可堆叠（stackMax=1）每件开新格", () => {
    const r = lootInto([], [{ itemCode: "eq_sword", qty: 2 }], eqOnly);
    expect(r.newStacks.map((n) => n.slotIndex)).toEqual([0, 1]);
    expect(r.newStacks.every((n) => n.quantity === 1 && n.durabilityMax !== null)).toBe(true);
  });
  it("包满进 lost（整条丢弃）", () => {
    const full = Array.from({ length: BAG_SLOTS }, (_, i) => row(i + 1, "stone", i, 99));
    const r = lootInto(full, [{ itemCode: "stone", qty: 10 }], stackable);
    expect(r.lost).toEqual([{ itemCode: "stone", qty: 10 }]);
  });
  it("部分入包：能放的进，放不下的整条丢", () => {
    const bag = Array.from({ length: BAG_SLOTS }, (_, i) => row(i + 1, "stone", i, 99));
    const r = lootInto(bag, [{ itemCode: "yao", qty: 5 }], stackable);
    expect(r.lost).toEqual([{ itemCode: "yao", qty: 5 }]);
  });
});

describe("planEquip", () => {
  const mk = (over: Partial<Item> = {}): Item => ({
    code: "eq_x", name: "测试装备", sprite: "/i.png", desc: "", kind: "equipment",
    quality: "green", slot: "main_hand", equipType: "剑", profession: null,
    levelReq: 4, durabilityMax: 10, hands: 1, dmgMin: 5, dmgMax: 7, intervalMs: 2100,
    bonuses: {}, ...over,
  } as Item);
  const char = { level: 5, profession: "warrior" as const };
  const itemByCode = (code: string): Item | undefined => (code === "eq_2h" ? mk({ code: "eq_2h", hands: 2 }) : mk({ code }));

  it("空部位直接穿", () => {
    const p = planEquip(mk(), 11, char, [], itemByCode);
    expect(p).toEqual({ ok: true, targetSlot: "main_hand", unequipInventoryIds: [] });
  });
  it("部位占用直接替换（旧装备回包）", () => {
    const equipped = [{ slotCode: "main_hand" as const, inventoryId: 3, itemCode: "eq_old" }];
    const p = planEquip(mk(), 11, char, equipped, itemByCode);
    expect(p).toEqual({ ok: true, targetSlot: "main_hand", unequipInventoryIds: [3] });
  });
  it("等级不足拒绝", () => {
    const p = planEquip(mk({ levelReq: 6 }), 11, char, [], itemByCode);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toContain("等级");
  });
  it("职业不符拒绝", () => {
    const p = planEquip(mk({ profession: "mage" }), 11, char, [], itemByCode);
    expect(p.ok).toBe(false);
  });
  it("穿双手武器联动卸下副手", () => {
    const equipped = [
      { slotCode: "off_hand" as const, inventoryId: 5, itemCode: "eq_shield" },
    ];
    const p1 = planEquip(mk({ hands: 2, code: "eq_2h" }), 11, char, equipped, itemByCode);
    expect(p1).toEqual({ ok: true, targetSlot: "main_hand", unequipInventoryIds: [5] });
  });
  it("穿副手联动卸下双手主武器", () => {
    const equipped = [{ slotCode: "main_hand" as const, inventoryId: 3, itemCode: "eq_2h" }];
    const p = planEquip(mk({ slot: "off_hand", dmgMin: undefined, dmgMax: undefined, intervalMs: undefined, defBonus: 3, code: "eq_shield" }), 11, char, equipped, itemByCode);
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.unequipInventoryIds).toEqual([3]);
  });
  it("戒指：优先 ring1，再 ring2，都满替换 ring1", () => {
    const ring = mk({ slot: "ring", dmgMin: undefined, dmgMax: undefined, intervalMs: undefined, code: "eq_ring" });
    const p0 = planEquip(ring, 11, char, [], itemByCode);
    expect(p0.ok && p0.targetSlot).toBe("ring1");
    const one = [{ slotCode: "ring1" as const, inventoryId: 6, itemCode: "eq_ring" }];
    expect(planEquip(ring, 11, char, one, itemByCode).ok && (planEquip(ring, 11, char, one, itemByCode) as { targetSlot: string }).targetSlot).toBe("ring2");
    const two = [...one, { slotCode: "ring2" as const, inventoryId: 7, itemCode: "eq_ring" }];
    const p2 = planEquip(ring, 11, char, two, itemByCode);
    expect(p2.ok && p2.targetSlot).toBe("ring1");
    expect(p2.ok && p2.unequipInventoryIds).toEqual([6]);
  });
  it("非装备物品拒绝", () => {
    const p = planEquip({ code: "yao", name: "药", sprite: "/i.png", desc: "", kind: "consumable", effect: { hp: 1 }, stackMax: 99 }, 11, char, [], itemByCode);
    expect(p.ok).toBe(false);
  });
});

describe("firstFreeSlot", () => {
  it("返回最小空闲格；满包返回 null", () => {
    expect(firstFreeSlot([row(1, "a", 0, 1), row(2, "a", 2, 1)])).toBe(1);
    const full = Array.from({ length: BAG_SLOTS }, (_, i) => row(i + 1, "s", i, 1));
    expect(firstFreeSlot(full)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**（`import type { Item } from "../data/schemas.ts"` 与 `import type { LootItem } from "./drops.ts"`；`lootInto` 实现要点：先复制 bag 到工作区 Map<slotIndex, BagRow>，按 loot 依序处理，堆叠找同码 `quantity < stackMaxOf(code)` 的行按 slot 升序填，`newStacks` 里装备 `durabilityMax` 取 `itemByCode(code)` 为 equipment 时的值否则 null；`planEquip` 中双手联动查 equipped 里 `main_hand` 的 itemCode 经 `itemByCode` 判 `hands===2`——查不到（静态漂移）按非双手处理）

- [ ] **Step 4: 跑测试通过**

- [ ] **Step 5: Commit**

```bash
git add server/src/game/inventory.ts server/test/unit/game/inventory.test.ts
git commit -m "feat: 背包入包分配与穿戴替换计划纯函数"
```

---

### Task 4: 装备加成汇总 equipment.ts（纯函数）

**Files:**
- Create: `server/src/game/equipment.ts`
- Test: `server/test/unit/game/equipment.test.ts`

**Interfaces:**
- Consumes: `Item`/`EquipmentItem`（Task 1）
- Produces:

```ts
export interface EquippedRow {
  slotCode: string;       // 运行时栏位（ring1/ring2…）
  itemCode: string;
  durability: number | null;
}
export interface EquipmentBonuses {
  vit: number; str: number; agi: number; intel: number; spr: number; // 五维加成（开战时并入派生属性）
  hp: number; sp: number;
  atk: number;            // 原版「攻击:+N」词条汇总（蓝宝书武器带，如能量之卷刃剑 +2），开战时直接加 atk
  def: number;            // defBonus 汇总
  dmgMin: number | null;  // 主手武器区间（无武器/耐久0 → null）
  dmgMax: number | null;
  intervalMs: number | null; // 主手武器攻速（无武器/耐久0 → null，用职业默认）
}
/** 耐久 0 或静态漂移（物品不存在/非装备）的行整体跳过（属性失效但不消失） */
export function equipmentBonusesOf(rows: EquippedRow[], itemByCode: (code: string) => Item | undefined): EquipmentBonuses
```

- [ ] **Step 1: 写失败单测**

```ts
import { describe, expect, it } from "vitest";
import { equipmentBonusesOf, type EquippedRow } from "../../../src/game/equipment.ts";
import type { Item } from "../../../src/data/schemas.ts";

const mk = (over: Partial<Item> = {}): Item => ({
  code: "eq_x", name: "装备", sprite: "/i.png", desc: "", kind: "equipment",
  quality: "green", slot: "chest", equipType: "皮甲", profession: null,
  levelReq: 1, durabilityMax: 10, hands: 1, defBonus: 2, bonuses: { hp: 10, str: 1 },
} as Item);

const byCode = (code: string): Item | undefined => {
  if (code === "eq_sword") return mk({ code, slot: "main_hand", dmgMin: 7, dmgMax: 9, intervalMs: 2100, defBonus: undefined, bonuses: {} });
  if (code === "eq_atk_sword") return mk({ code, slot: "main_hand", dmgMin: 10, dmgMax: 14, intervalMs: 2100, defBonus: undefined, bonuses: { atk: 2 } }); // 能量之卷刃剑型
  if (code === "eq_2h") return mk({ code, slot: "main_hand", hands: 2, dmgMin: 10, dmgMax: 14, intervalMs: 2600, defBonus: undefined, bonuses: {} });
  if (code === "gone") return undefined; // 静态漂移
  return mk({ code });
};

it("汇总防具 def/bonuses 与武器区间攻速", () => {
  const rows: EquippedRow[] = [
    { slotCode: "chest", itemCode: "eq_a", durability: 5 },
    { slotCode: "main_hand", itemCode: "eq_sword", durability: 3 },
  ];
  const b = equipmentBonusesOf(rows, byCode);
  expect(b.def).toBe(4); // 两件各 defBonus 2
  expect(b.hp).toBe(20);
  expect(b.str).toBe(2);
  expect(b.dmgMin).toBe(7);
  expect(b.dmgMax).toBe(9);
  expect(b.intervalMs).toBe(2100);
});

it("atk 词条汇总（蓝宝书「攻击:+N」）", () => {
  const b = equipmentBonusesOf([{ slotCode: "main_hand", itemCode: "eq_atk_sword", durability: 3 }], byCode);
  expect(b.atk).toBe(2);
  expect(b.str).toBe(0); // atk 词条不进五维
});

it("耐久 0 整件失效（武器失效无区间）", () => {
  const b = equipmentBonusesOf([{ slotCode: "main_hand", itemCode: "eq_sword", durability: 0 }], byCode);
  expect(b.dmgMin).toBeNull();
  expect(b.dmgMax).toBeNull();
  expect(b.intervalMs).toBeNull();
  expect(b.def).toBe(0);
});

it("静态漂移行跳过不崩溃", () => {
  const b = equipmentBonusesOf(
    [{ slotCode: "chest", itemCode: "gone", durability: 5 }, { slotCode: "neck", itemCode: "not_a_kind", durability: 5 }],
    byCode,
  );
  expect(b.def).toBe(0);
});

it("空装备全零无武器", () => {
  expect(equipmentBonusesOf([], byCode)).toEqual({
    vit: 0, str: 0, agi: 0, intel: 0, spr: 0, hp: 0, sp: 0, atk: 0, def: 0,
    dmgMin: null, dmgMax: null, intervalMs: null,
  });
});
```

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**（五维/hp/sp/atk 从 `bonuses` 累加；`def` 累加 `defBonus ?? 0`；主手武器行（`item.slot === "main_hand"` 且耐久 > 0）取 `dmgMin/dmgMax/intervalMs`——副手不会带这些字段（schema 已锁），无需特判）
- [ ] **Step 4: 跑测试通过**
- [ ] **Step 5: Commit**

```bash
git add server/src/game/equipment.ts server/test/unit/game/equipment.test.ts
git commit -m "feat: 装备加成汇总纯函数(耐久0失效,静态漂移跳过)"
```

---

### Task 5: 引擎武器伤害区间（Combatant 扩展）

**Files:**
- Modify: `server/src/game/engine.ts`（Combatant 接口 + resolveAttack）
- Test: `server/test/unit/game/engine.test.ts`（扩展）

**Interfaces:**
- Produces: `Combatant` 增可选字段 `dmgMin?: number; dmgMax?: number;`——普攻与 `next_hit_bonus` 技能的普攻 roll 部分改用 `rng.int(attacker.dmgMin ?? UNARMED_MIN, attacker.dmgMax ?? UNARMED_MAX)`；怪物不带字段行为不变；旧快照（无字段）经 `??` 天然回退徒手。

- [ ] **Step 1: 写失败单测**（追加到 engine.test.ts；夹具照既有 `meFixture/foeFixture`）

```ts
it("普攻用武器伤害区间替代徒手", () => {
  // 必中不暴击：伤害 = roll + atk − def；徒手 roll∈[1,3]、武器 [7,9]
  const unarmed = createBattleState({ me: meFixture(), foe: foeFixture(), foeExp: 10 }, 42, 0);
  const armed = createBattleState(
    { me: meFixture({ dmgMin: 7, dmgMax: 9 }), foe: foeFixture(), foeExp: 10 }, 42, 0,
  );
  const a = advance(unarmed, 1000);
  const b = advance(armed, 1000);
  const da = a.events.find((e) => e.kind === "hit")!.amount!;
  const db = b.events.find((e) => e.kind === "hit")!.amount!;
  expect(da).toBeGreaterThanOrEqual(1 + 5 - 0);  // roll_min + atk − def
  expect(db).toBeGreaterThanOrEqual(7 + 5 - 0);  // 武器下限抬升
  expect(db).toBeLessThanOrEqual(9 + 5 - 0);
});

it("旧快照无 dmgMin/dmgMax 字段时间线不变（?? UNARMED 兜底）", () => {
  const s = createBattleState({ me: meFixture(), foe: foeFixture(), foeExp: 10 }, 42, 0);
  const hacked = JSON.parse(JSON.stringify(s)); // 模拟持久化往返后无新字段
  expect(advance(hacked, 60000).events.map((e) => e.text)).toEqual(advance(s, 60000).events.map((e) => e.text));
});
```

- [ ] **Step 2: 跑测试确认失败**（Combatant 无 dmgMin 字段——TS 编译错或断言失败）

- [ ] **Step 3: 实现**：Combatant 加两可选字段（带注释「武器伤害区间；无武器/旧快照缺省 → 徒手 1~3」）；`resolveAttack` 普攻与 `next_hit_bonus` 分支的 `rng.int(UNARMED_MIN, UNARMED_MAX)` 改为 `rng.int(attacker.dmgMin ?? UNARMED_MIN, attacker.dmgMax ?? UNARMED_MAX)`。**注意**：direct_damage 分支不变。

- [ ] **Step 4: 跑全部单测通过**（既有固定种子用例必须全绿——怪物侧不带字段，序列不变）

Run: `pnpm --filter maoyouji-server test`

- [ ] **Step 5: Commit**

```bash
git add server/src/game/engine.ts server/test/unit/game/engine.test.ts
git commit -m "feat: 战斗引擎普攻支持武器伤害区间(旧快照兜底徒手)"
```

---

### Task 6: battle.ts 开战并装 + 结算掉落/铜币/耐久

**Files:**
- Modify: `server/src/routes/battle.ts`
- Modify: `server/src/game/engine.ts`（`BattleState.over` 增 `drops?` 展示快照类型）
- Modify: `server/test/db/helpers.ts`（resetDb 追加清 `character_inventory`/`character_equipment`）
- Test: `server/test/db/battle.test.ts`（扩展）

**Interfaces:**
- Consumes: Task 2/3/4 全部导出。
- Produces: `BattleState.over.drops?: { copper: number; items: { code: string; name: string; quality: string; qty: number }[]; lost: { name: string; qty: number }[] }`（展示快照：服务端填名称品质，前端零静态数据依赖）。开战时玩家 Combatant 已含装备加成。

- [ ] **Step 1: 写失败 db 测试**（追加到 battle.test.ts；复用该文件既有辅助：`battleStart/battleState/battleRowOf/patchState/monsterInstanceOf`，`patchState(battleId, patch)` 可直接改 state.seed）

```ts
it("victory：铜币入账、掉落入包、over.drops 对账", async () => {
  // 建角色 → 走到有怪格 → battleStart → patchState 把 seed 改为已知值 12345
  //   （其余不动），再 battleState 快进到终局。
  // 断言（关系断言，与掉落随机性解耦）：
  // 1. 角色 copper 增量 === over.drops.copper
  // 2. over.drops.items 每项：包内对应 (item_code, 总 quantity) 与之对账（含堆叠合并）
  // 3. 包内新增行的 item_code 全部 ∈ 该怪掉落表
  // 4. battles.result = 'victory' 且 state.over.drops 非空
});

it("defeat：全身装备耐久 -ceil(5%×durabilityMax)", async () => {
  // 建角色 → SQL 直插 character_inventory 两行装备 + character_equipment 绑定
  //   （木盾 durabilityMax 10 → 打败后 durability = 9）
  // → 开战 → 把角色 hp 改成 1 → 轮询至终局 defeat
  // → SELECT durability：木盾 10→9；另一件同样 -ceil(max×0.05)
  // 且角色回 jiaotang、满血（既有 defeat 断言口径不变）
});
```

- [ ] **Step 2: 跑 db 测试确认失败**

Run: `pnpm --filter maoyouji-server test:db`
Expected: FAIL（over.drops 不存在 / 铜币不变）

- [ ] **Step 3: 实现开战并装**（battle.ts `/start` 路由，惰性恢复之后、createBattleState 之前）：

```ts
// 装备加成：join 穿戴行（耐久 0/静态漂移在 equipmentBonusesOf 内失效），并入派生属性
const [eqRows] = await conn.query<RowDataPacket[]>(
  `SELECT e.slot_code, i.item_code, i.durability
   FROM character_equipment e JOIN character_inventory i ON i.id = e.inventory_id
   WHERE e.character_id = ?`,
  [characterId],
);
const eq = equipmentBonusesOf(
  eqRows.map((r) => ({ slotCode: r.slot_code as string, itemCode: r.item_code as string, durability: r.durability == null ? null : Number(r.durability) })),
  (code) => itemIndex().get(code),
);
const strEff = c.str + eq.str;
const agiEff = c.agi + eq.agi;
const intelEff = c.intel + eq.intel;
// me 组装处替换（口径：characters.hp 列恒基础上限内，开战快照上限 = 基础 + 装备 hp 加成）：
//   maxHp: maxHp + eq.hp
//   maxSp: maxSp + eq.sp
//   atk: atkOf(c.profession, strEff, intelEff) + eq.atk
//   def: defOf(agiEff) + eq.def
//   dodge: dodgeOf(agiEff)
//   intervalMs: eq.intervalMs ?? PLAYER_ATTACK_MS[c.profession]
//   dmgMin/dmgMax: eq.dmgMin ?? undefined / eq.dmgMax ?? undefined
```

- [ ] **Step 4: 实现 settleBattle 结算扩展**

victory 分支（斩杀统计 UPSERT 之后）：

```ts
// —— 掉落（续用战斗种子：advance 尾部已回写最新 RNG 状态）——
const drops = monsterIndex().get(battle.monsterCode)?.drops;
const dropsView: NonNullable<BattleState["over"]>["drops"] = { copper: 0, items: [], lost: [] };
if (drops) {
  const loot = rollDrops(drops, createRng(state.seed));
  dropsView.copper = loot.copper;
  if (loot.copper > 0) {
    await conn.query("UPDATE characters SET copper = copper + ? WHERE id = ?", [loot.copper, battle.characterId]);
  }
  if (loot.items.length > 0) {
    // 锁角色行（本函数 victory 已 SELECT 角色——把那条 SELECT 改为带 FOR UPDATE，
    // 与穿脱路由的锁角色行纪律互斥），再全量读背包格行
    const [bagRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, item_code, slot_index, quantity FROM character_inventory
       WHERE character_id = ? AND slot_index IS NOT NULL FOR UPDATE`,
      [battle.characterId],
    );
    const bag = bagRows.map((r) => ({ id: Number(r.id), itemCode: r.item_code as string, slotIndex: Number(r.slot_index), quantity: Number(r.quantity) }));
    const { stackAdds, newStacks, lost } = lootInto(bag, loot.items, (code) => {
      const it = itemIndex().get(code);
      return it && it.kind !== "equipment" ? it.stackMax : 1;
    });
    for (const a of stackAdds) {
      await conn.query("UPDATE character_inventory SET quantity = quantity + ? WHERE id = ?", [a.quantity, a.id]);
    }
    for (const n of newStacks) {
      await conn.query(
        `INSERT INTO character_inventory (character_id, item_code, slot_index, quantity, durability)
         VALUES (?, ?, ?, ?, ?)`,
        [battle.characterId, n.itemCode, n.slotIndex, n.quantity, n.durabilityMax],
      );
    }
    dropsView.items = loot.items.map((li) => {
      const it = itemIndex().get(li.itemCode);
      return { code: li.itemCode, name: it?.name ?? li.itemCode, quality: it?.kind === "equipment" ? it.quality : "", qty: li.qty };
    });
    dropsView.lost = lost.map((l) => ({ name: itemIndex().get(l.itemCode)?.name ?? l.itemCode, qty: l.qty }));
  }
}
state.over = { ...over(已含 killCount/totalExpGained 回填), drops: dropsView };
```

defeat 分支（回教堂 UPDATE 同事务；静态数据不进 SQL，损耗值在 JS 侧算）：

```ts
const [eqRows] = await conn.query<RowDataPacket[]>(
  `SELECT i.id, i.durability, i.item_code FROM character_inventory i
   JOIN character_equipment e ON e.inventory_id = i.id WHERE e.character_id = ? FOR UPDATE`,
  [battle.characterId],
);
for (const r of eqRows) {
  const max = itemIndex().get(r.item_code as string);
  if (max?.kind !== "equipment") continue; // 静态漂移兜底：跳过
  const dec = Math.ceil(max.durabilityMax * 0.05);
  await conn.query(
    "UPDATE character_inventory SET durability = GREATEST(0, durability - ?) WHERE id = ?",
    [dec, r.id],
  );
}
```

**纪律自查（Review Focus #5）**：victory 的角色 SELECT 改 `FOR UPDATE` 后，结算全程持 battle 行锁 + 角色行锁；Task 7 的全部背包写路由也必须先锁角色行——互斥成立。

- [ ] **Step 5: 跑 db 测试通过** + 全量单测不破

Run: `pnpm --filter maoyouji-server test:db && pnpm --filter maoyouji-server test`

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/battle.ts server/src/game/engine.ts server/test/db/helpers.ts server/test/db/battle.test.ts
git commit -m "feat: 战斗结算接入掉落铜币与死亡耐久损耗,开战并入装备加成"
```

---

### Task 7: 背包路由 routes/inventory.ts

**Files:**
- Create: `server/src/routes/inventory.ts`
- Modify: `server/src/app.ts`（注册 `inventoryRoutes`，prefix `/api/inventory`）
- Test: `server/test/db/inventory.test.ts`

**Interfaces:**
- Consumes: Task 1~4 导出；`requireCharacter`（plugins/auth.ts）；`hpMaxOf/spMaxOf`（rules.ts）。
- Produces（前端 Task 8 依赖的响应形状）:

```ts
// GET /api/inventory →
{
  copper: number,
  bag: Array<BagItemView>,                       // 仅未穿戴行，按 slotIndex 升序
  equipment: Record<EquipSlotCode, BagItemView | null>, // 14 栏位全量键
  bonuses: EquipmentBonuses,  // equipmentBonusesOf 原样输出（五维/hp/sp/def 数值 + dmgMin/dmgMax/intervalMs 可为 null=无有效武器）
}
// BagItemView = {
//   inventoryId, itemCode, slotIndex (背包行才有,装备位为 null), quantity, durability,
//   name, quality ("gray"…|"" 非装备), sprite, kind, stackMax,
//   equip?: { slot, equipType, hands, levelReq, dmgMin?, dmgMax?, intervalMs?, defBonus?, bonuses } // 仅装备
// }
// POST /api/inventory/equip   { inventoryId }            → { ok: true }
// POST /api/inventory/unequip { slotCode }               → { ok: true }
// POST /api/inventory/use     { inventoryId }            → { hp, sp }
// POST /api/inventory/discard { inventoryId, quantity? } → { ok: true }
```

- [ ] **Step 1: 写失败 db 测试**（`server/test/db/inventory.test.ts`；测试直接 SQL 造背包行，走 `app.inject()`）

用例清单（每条一个 it）：
1. `GET`：空背包返回 300 格口径的空数组 + copper 0 + 14 栏位全 null 的 equipment。
2. `GET`：背包行带静态 join 字段（name/quality/stackMax）；装备行带 equip 子对象。
3. `equip`：等级不足 → 400 且 message 含「等级」；职业不符（战士穿魔杖）→ 400。
4. `equip`：空部位成功 → inventory 行 slot_index=NULL，equipment 表出现 targetSlot。
5. `equip`：部位占用直接替换 → 旧装备回背包空格（slot_index=0）、新装备上位。
6. `equip`：替换后 equipment 表行校验——被替换件行 DELETE、新装备行 UPSERT 到 targetSlot（腾格顺序 ③④；双手联动 db 无法造数——items.json 无 hands=2 物品且静态数据不进库，由 Task 3 合成夹具单测覆盖）。
7. `equip`：**满包替换成功**（300 格全占时替换主手 → 旧装备进新装备腾出的原格，净 0；规格决策 7 二次修订）。
8. `unequip`：成功回包；**包满 → 400**（脱下净 +1 格）。
9. `use`：小型补血剂 → quantity -1（归零删行）、hp 回复不溢基础上限（把 hp 改成 max-10，用 50 药 → hp=max）、resources_updated_at 推进；非消耗品 → 400。
10. `use`：active 战斗中 → 409（先开一场战斗再 use）。
11. `discard`：整堆丢弃删行；带 quantity 部分丢弃减量；已穿戴（slot_index NULL）→ 400。
12. `equip`：inventoryId 不存在/不是当前角色的 → 404。

- [ ] **Step 2: 跑 db 测试确认失败**（路由不存在 → 404）

- [ ] **Step 3: 实现路由**（骨架；所有写路由的事务模板照 battle.ts：beginTransaction → **先 `SELECT id FROM characters WHERE id = ? FOR UPDATE` 锁角色行**（不存在回 404）→ 校验 → 写 → commit/rollback → release）

关键 SQL 与口径：
- 读背包视图：`SELECT id, item_code, slot_index, quantity, durability FROM character_inventory WHERE character_id = ?`，JS 里分 `slot_index === null`（已穿）与背包行；静态字段从 `itemIndex()` 取，未知 code 兜底 `{ name: itemCode, kind: "material", stackMax: 1, quality: "" }`（Review Focus #1）。
- `equip`：`planEquip(item, inventoryId, {level, profession}, equipped, itemIndex().get)` → 失败 400（reason 直传）→ 成功按**腾格顺序**执行：① `UPDATE character_inventory SET slot_index = NULL WHERE id = inventoryId`（新装备离包，其原格即刻空闲）② `unequipInventoryIds` 逐件重算 firstFreeSlot 分配空格并 `UPDATE ... SET slot_index = ?` ③ `INSERT ... ON DUPLICATE KEY UPDATE` 写 equipment（`uk (character_id, slot_code)`）④ 被替换件的 equipment 行 DELETE。替换在满包时天然成功（①腾出的格 ≥ 回包件数，规格决策 7）。
- `unequip`：`firstFreeSlot(bag)` 无空格 400；`UPDATE character_inventory SET slot_index = ? WHERE id = ?` + `DELETE FROM character_equipment WHERE character_id = ? AND slot_code = ?`。
- `use`：查 active battle（`SELECT id FROM battles WHERE character_id = ? AND status = 'active' LIMIT 1`）→ 409「战斗中无法使用物品」；物品 kind !== "consumable" → 400；`hp = MIN(hpMaxOf(level, vit), hp + effect.hp)`、`sp = MIN(spMaxOf(level, intel), sp + effect.sp)`；`UPDATE characters SET hp=?, sp=?, resources_updated_at = NOW()`；`UPDATE character_inventory SET quantity = quantity - 1`，quantity 归零 `DELETE`。**并入口径**：effect.hp/effect.sp 都按「基础上限」clamp（characters 列恒基础口径，Global Constraints）。
- `discard`：`slot_index IS NULL` → 400「已穿戴的装备不能丢弃」；带 quantity → `GREATEST(0, quantity - ?)` 归零删行。

app.ts 注册：`app.register(inventoryRoutes, { prefix: "/api/inventory" });`

- [ ] **Step 4: 跑 db 测试通过 + 全量单测**

Run: `pnpm --filter maoyouji-server test:db && pnpm --filter maoyouji-server test`

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/inventory.ts server/src/app.ts server/test/db/inventory.test.ts
git commit -m "feat: 背包路由(穿脱替换联动/用药/丢弃,角色行锁互斥)"
```

---

### Task 8: 前端背包面板 + 装备栏 + 结算掉落行

**Files:**
- Create: `web/src/components/InventoryPanel.vue`
- Create: `web/src/quality.ts`
- Modify: `web/src/api.ts`
- Modify: `web/src/components/GameShell.vue`

**Interfaces:**
- Consumes: Task 7 全部响应形状（`BagItemView` 等照抄进 api.ts）。
- Produces: `api.inventory()/equip(inventoryId)/unequip(slotCode)/useItem(inventoryId)/discard(inventoryId, quantity?)`；`QUALITY_COLORS` 常量。

- [ ] **Step 1: api.ts 扩展**——接口 `InventoryView`/`BagItemView`（字段照 Task 7 Produces，snake 转前端 camel）；`BattleResponseState.over` 加 `drops?: { copper: number; items: { code: string; name: string; quality: string; qty: number }[]; lost: { name: string; qty: number }[] }`；api 对象追加五个方法（POST JSON，模式照 `battleSkill`）。

- [ ] **Step 2: web/src/quality.ts**

```ts
/** 装备品质色（原版口径：紫 #8a2be2；docs/superpowers/specs/2026-09-22-drops-inventory-design.md） */
export const QUALITY_COLORS: Record<string, string> = {
  gray: "#9c9c9c",
  green: "#4caf50",
  blue: "#2f7bd8",
  purple: "#8a2be2",
  orange: "#ff8c00",
};
export const QUALITY_NAMES: Record<string, string> = {
  gray: "粗制", green: "优秀", blue: "精良", purple: "史诗", orange: "传说",
};
```

- [ ] **Step 3: InventoryPanel.vue**——复刻原版道具窗口（参考 `docs/游戏界面结构参考.md` 的窗口风格：浅蓝渐变面板 `#cde9f5 → #aed7ea`、深蓝正文 `#14506e`、宋体 12px、Windows 立体边框）：

布局（绝对定位覆盖在主区上，窗口 620×420）：
- 标题栏「道具背包」+ 关闭按钮
- 顶部一行：铜币显示（`copper` 换算 金/银/铜：1金=10000铜、1银=100铜，不足进位显示，如 `1金2银3铜`；0 显示 `0铜`）
- 左侧装备栏：14 栏位按 4 列网格（main_hand/off_hand/head/shoulder/chest/hands/waist/legs/feet/wrist/ring1/ring2/neck/cloak），已穿显示名字缩写+品质色边框，点击=脱下（`unequip`）
- 右侧背包格：`display: grid; grid-template-columns: repeat(10, 1fr); overflow-y: auto`（300 格滚动），每格显示数量角标（qty>1）与物品名首字/缩写，装备格用品质色名字；点击弹小操作条（装备→「穿戴」、消耗品→「使用」、全部→「丢弃」）
- 操作后重拉 `api.inventory()`；错误 `ApiError.message` toast（GameShell 既有 `toast()` 模式，props 传入或 emit）

- [ ] **Step 4: GameShell.vue 集成**：
  - 底部快捷区（与其他按钮同排）加「道具」按钮，素材用 `web/public/ui/` 下若有原版道具按钮则用之，否则文字按钮（**先拷贝** `assets/图标/道具按钮.gif` → `web/public/ui/道具按钮.gif`，与其他按钮同款用法——看 GameShell 既有按钮的引用方式照做）
  - `showBag` ref 控制面板 v-if 挂载 `<InventoryPanel>`
  - 战斗结算：`pushBattleResult` 里 `over.drops` 非空时追加聊天行（sys 类）：铜币 `获得 X 铜币`、每件 `获得 [名字]×qty`（品质色 span，styles 用 QUALITY_COLORS 内联）、lost 每条 `背包已满，[名字]×qty 丢失了`（红色）

- [ ] **Step 5: 类型检查与构建**

Run: `pnpm --filter maoyouji-web build`
Expected: vue-tsc 零错误

- [ ] **Step 6: Commit**

```bash
git add web/src/api.ts web/src/quality.ts web/src/components/InventoryPanel.vue web/src/components/GameShell.vue web/public/ui/
git commit -m "web: 背包装备栏面板与结算掉落展示(品质色)"
```

---

### Task 9: 全量回归

- [ ] **Step 1:** `pnpm test`（server unit + web）全绿
- [ ] **Step 2:** `pnpm --filter maoyouji-server test:db` 全绿（需 `pnpm db:up`）
- [ ] **Step 3:** `pnpm --filter maoyouji-web build` 零错误
- [ ] **Step 4: 1400×832 手动回归**（`pnpm dev`，浏览器 1400×832）：
  1. 建战士角色 → 牧野草原打绿毛虫/泡泡 ×N → 出现铜币/材料/药水掉落，聊天区掉落行品质色正确
  2. 开背包 → 300 格滚动正常 → 使用小型补血剂回血（血条/数值变化）
  3. 装备农夫之剑 → 再打怪伤害明显抬升、攻速变慢（2600ms 可感知）
  4. 替换主手武器（农夫之剑→打怪掉步兵剑穿上）→ 旧剑回包
  5. 故意送死 → 复活教堂 → 装备耐久减少可见（背包查看）
  6. 法师角色重复 2/3（橡木杖线）
  （双手占副手规则原版 1~10 级无实装物品，由 Task 3 合成夹具单测验证，手动回归不覆盖）
- [ ] **Step 5: 收尾 commit**（如有手动回归发现的小修）+ 汇报

---

## 数值与口径速查（实现时勿再决策，全在此锁定）

- 物品 35 件 = 装备 26（战士剑 5 + 魔杖 4 + 盾牌 5 + 穿着 11 + 戒指 1）+ 消耗品 2 + 材料 7（蓝宝书考据）—— Task 1 Step 5 全量 JSON
- 5 怪掉落表 —— Task 1 Step 6 表格（物品种类按原版，chance/qty/copper 手配）
- 蓝宝书映射：伤害/速度（×1000→intervalMs）/耐久（取上限）/等级/五维加成照抄；防御 `ceil(原版防御 ÷ 25)`；「攻击：+N」→ `bonuses.atk`；魔杖属性伤害只取数值；命中/闪避词条不做
- 双手武器：原版 1~10 级无真双手，规则由 Task 3 合成夹具验证，items.json 不配
- 开战属性组装：`strEff=str+eq.str` 等 → `atkOf/defOf/dodgeOf` 用有效五维；`atk + eq.atk`；`maxHp+eq.hp`、`maxSp+eq.sp`；`intervalMs = eq.intervalMs ?? PLAYER_ATTACK_MS[profession]`；`dmgMin/dmgMax = eq.* ?? undefined`
- `characters.hp/sp` 列恒为基础口径（不含装备）；用药/复活/惰性恢复全部 clamp 基础上限
- 死亡耐久 `-ceil(durabilityMax × 0.05)`、下限 0；耐久 0 可穿可用（展示失效状态）但加成全失效
- RNG 契约：rollDrops ①copper 1 掷 ②逐条 chance 1 掷+命中后 qty 恒 1 掷；qtyMin===qtyMax 也掷

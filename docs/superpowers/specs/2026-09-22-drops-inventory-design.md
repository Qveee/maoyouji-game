# 切片 5 设计：掉落 + 背包 + 穿脱（2026-09-22 用户已确认）

> 状态：设计已批准，spec 评审中。

## 已确认决策

1. **掉落 RNG 续用战斗种子**：`advance` 结束已把 RNG 状态回写 `state.seed`，结算 victory 分支 `createRng(state.seed)` 直接续流；同种子回放掉落完全复现。
2. **背包满处理**：结算事务内先入账能放的，放不下的直接丢弃，并在 `state.over.drops.lost` 与前端结算面板提示「背包已满，X 丢失」。
3. **消耗品纳入**：本切片含「使用药水」（仅战斗外）；掉落表配小红/中红/小蓝药。
4. **静态数据组织**：单 `items.json`（discriminated union，统一 code 空间），掉落表内嵌 `monsters.json` 每怪 `drops` 字段。
5. **品质表里定死**：掉落表直接配具体物品（含品质），不做品质二次随机（蓝宝书口径）。
6. **武器攻速生效**：武器 `intervalMs` 本切片即按蓝宝书真实速度生效（如步兵剑 2.1s），接受战斗节奏变化；无武器时用现行职业默认（战士 2000ms/法师 2200ms）。
7. **穿戴冲突直接替换**（2026-09-22 修订，同日二次修订：替换永可行）：目标部位已有装备 → 旧装备自动回背包、新装备上位（如单手剑在位再穿枪，直接换）；穿双手武器时副手有装备 → 副手件自动回背包；反之穿副手时主手是双手武器 → 双手武器自动回背包。**替换永远可行**：被穿的装备必来自背包，离包即腾格，任何替换的背包净占用 ≤ 0，玩家装备永不丢失；仅**显式脱下**净 +1 格，包满时脱下拒绝并提示。等级/职业不符仍拒绝。

## 范围

- 静态数据：`server/data/items.json` + `monsters.json` 加 `drops`；loader 交叉校验（掉落引用物品必存在、slot 枚举合法），失败拒绝启动。
- 掉落引擎：`server/src/game/drops.ts` 纯函数 `rollDrops(drops, rng)`，RNG 消耗顺序锁定（先 copper，再按表序逐条 chance、命中后掷 qty）并写注释。
- 背包：`game/inventory.ts` 纯函数（入包分配/穿戴校验与替换联装）+ `routes/inventory.ts`（GET / equip / unequip / use / discard），300 格上限，可堆叠物先堆后开格，装备 qty 恒 1 独立行。部位占用走直接替换（决策 7）。
- 装备属性接入战斗：`game/equipment.ts` 纯函数汇总加成；`battle.ts` 开战组装 Combatant 时并入；`engine.ts` Combatant 加可选 `dmgMin/dmgMax`（`?? UNARMED` 兜底，怪物侧与旧快照行为不变）；`rules.ts` 签名不动（保持无装备基准）。
- 铜币：victory 时按 `drops.copper` 区间 roll 入账 `characters.copper`（结算缺口补齐）。
- 死亡耐久：defeat 时全身装备 `durability -= ceil(durabilityMax × 5%)`，下限 0。
- 前端：背包面板（300 格滚动、品质色、穿/用/丢）、装备栏 12+1 部位、战斗结算掉落行。
- 无新迁移：`character_inventory` / `character_equipment`（001 已建）够用；`resetDb()` 需追加清这两张既有表（防跨 run 残留），schema 表清单断言不动。

## 明确不做（二期或后续切片）

强化（enhance_level）、随机词条（affixes）、套装特效、修理 NPC、商店购买（`character_shop_buys` 留空）、"每 10 场战斗耐久 -1"（规则文档标注建议值待平衡）、全服掉落公告跑马灯（结算面板内展示代替）、卖出/交易。

## 数据结构

### items.json（kind 判别 union）

```
consumable: code/name/sprite/desc + effect{hp?,sp?} + stackMax(99)
material:   同上，无 effect
equipment:  quality: gray|green|blue|purple|orange
            slot: main_hand|off_hand|head|shoulder|chest|hands|waist|
                  legs|feet|wrist|ring|neck|cloak   （戒指运行时占 ring1/ring2）
            equipType: 剑/刀/枪/匕首/爪/魔杖/盾牌/法典/布甲/皮甲…
            profession: warrior|mage|null（武器限定；防具 null）
            hands: 1|2（仅武器；双手占副手）
            levelReq + durabilityMax
            武器：dmgMin/dmgMax/intervalMs
            防具：defBonus + bonuses{vit/str/agi/intel/spr/hp/sp?}
```

### monsters.json 每怪可选 drops

```
drops: { copper: [min, max],
         items: [ { item, chance, qtyMin?=1, qtyMax?=1 } ] }  // 逐条独立概率
```

### 品质色（前端常量，原版口径紫色 #8a2be2）

灰 `#9c9c9c` / 绿 `#4caf50` / 蓝 `#2f7bd8` / 紫 `#8a2be2` / 橙 `#ff8c00`

## 最小数据集（手写，蓝宝书有据对齐、缺失处手写平衡值）

- 战士剑 3 档（1/4/8 级，步兵剑按考据：右手剑 7-9 伤害 速度 2.1 耐久 13/13 需要等级 4）+ 法师魔杖 3 档
- 防具约 8 件（1-10 级 头/胸/腿/鞋）
- 药水：小红药（HP）/中红药/小蓝药（SP）
- 材料 2-3 种（泡泡粘液等，喂切片 6 任务）
- 掉落：猫隐村周边 + 牧野草原 1-10 级怪全配

## 并发与事务口径

- 所有改背包/结算路由统一先 `SELECT ... FOR UPDATE` 角色行，与结算临界区互斥。
- 掉落判定+入包+铜币+耐久全部在 `settleBattle` 同一事务内；掉落结果回填 `state.over.drops = { copper, items, lost }` 随 `battles.state` 持久化。
- 用药水：扣数量、HP/SP 回复不溢上限、推进 `resources_updated_at`；active 战斗中 409。

## 验收

- unit（固定种子）：rollDrops 全 miss/命中/qty/顺序锁定；lootInto 堆叠/满包 lost；equipmentBonusesOf 汇总/耐久 0 失效；engine 武器区间替换徒手且怪物侧时间线不变。
- db：victory 掉落入包+铜币+state.over.drops；defeat 耐久 -5%；穿脱校验链（等级/职业拒绝、部位占用直接替换、双手↔副手联动卸下、背包满替换拒绝）；用药/丢弃；300 格上限。
- 浏览器实测：打怪 → 掉落进包 → 穿装备 → 面板属性变化 → 再打怪伤害提升；背包满丢提示；1400×832 手动回归。

## 实施顺序（writing-plans 阶段细化）

1. items.json + monsters.json drops + schemas/loader 校验（TDD）
2. drops.ts / inventory.ts / equipment.ts 纯函数（TDD 核心）
3. engine.ts 武器区间 + battle.ts 开战并入装备加成
4. settleBattle 掉落/铜币/耐久 + inventory 路由
5. 前端背包面板 + 装备栏 + 结算掉落行

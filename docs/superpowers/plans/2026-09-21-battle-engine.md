# 切片 4：战斗引擎 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通「牧野草原刷怪 → 发起战斗 → 惰性结算（胜/败/平）→ 经验升级 / 教堂复活」核心循环，含前端战斗覆盖层与技能强化。

**Architecture:** 静态数据新增 monsters/skills JSON（zod 校验+交叉引用）；迁移 003 新增 `battles`（战斗状态 JSON 快照）与 `map_node_monsters`（每格怪物实例）。结算器为**纯函数**（固定种子 mulberry32 + 时间快进 `advance(state, target)`），服务器零定时器，前端 1s 轮询驱动；技能 = POST 指令（强化下一次出手）；3 分钟上限在快进时判定为平局。胜→经验+升级（`character_monster_stats` UPSERT），败→传送猫隐村教堂满状态复活，平→无得失。

**Tech Stack:** Fastify 5 + mysql2 手写 SQL + zod；Vue 3 SFC（GameShell 内战斗覆盖层）；Vitest（unit + db 两档）。

**依据文档:** 设计定稿 `docs/superpowers/specs/2026-09-20-battle-engine-design.md`、规则权威 `docs/游戏规则设计.md` §3/§6/§7、技能数值 `docs/技能书与对应技能表.xlsx`（强力打击1级/火球术1级）、怪物血量 `docs/猫游记怪物血量大全.xlsx`（牧野草原 7 条）、地图点位 `assets/地图/牧野草原/牧野草原-标注版.jpg`（邻接关系已按图手工标定，见 Task 5）。

---

## 数值决策（本计划锁定，实现时照抄）

### 派生公式（`docs/游戏规则设计.md` §3.3，无装备 MVP 基准）
- HP上限 `50 + vit×8 + level×10`；SP上限 `30 + intel×5 + level×5`（创建角色已按此实现）
- 攻击力：战士 `str×2`、法师 `intel×2`；防御 `floor(agi×1.5)`
- 闪避率 `min(40%, agi×0.3%)`；暴击率 5%；暴击伤害 150%（向下取整）
- 徒手基础伤害区间 **1~3**（无武器系统前的 MVP 基准）；攻速间隔：战士 **2000ms**、法师 **2200ms**
- 战斗内每回合（己方每次出手后）回 HP `floor(1 + spr×0.5)`
- 战斗外惰性恢复（每 5s 一跳，按 `resources_updated_at` 时间差补算）：
  `hpGain = floor(跳数 × (1 + spr×0.5))`、`spGain = floor(跳数 × (1 + intel×0.2))`，封顶各自上限

### 升级（MVP 锁定）
- 升级所需 `expNeed(L) = floor(100 × L^1.5)`；溢出进位，可连升
- 每级五维成长用**无状态差分取整**：`gain(g, L) = floor(g×L) − floor(g×(L−1))`（长期收敛到 growth 系数本身）
- 职业主属性每级额外 +1（战士 str / 法师 intel）；升级后 HP/SP 上限重算，当前值加上限增量

### 怪物（monsters.json，4 种——泡泡/黑蘑菇无精灵图素材，不上）
| code | 名 | 等级 | HP | 攻 | 防 | 闪避 | 暴击 | 攻速间隔 | 经验 | 精灵图 |
|---|---|---|---|---|---|---|---|---|---|---|
| lvmaochong | 绿毛虫 | 1 | 20~40 | 2~4 | 0 | 2% | 2% | 2200ms | 40 | /monsters/LuMaoChong.gif |
| xiaoji | 小鸡 | 2 | 20~40 | 3~5 | 1 | 3% | 2% | 2000ms | 50 | /monsters/XiaoJi.gif |
| hongmogu | 红蘑菇 | 4 | 40~60 | 4~7 | 2 | 4% | 3% | 2400ms | 80 | /monsters/mogu2.gif |
| caoyuanxie | 草原蝎 | 5 | 40~60 | 5~8 | 2 | 3% | 3% | 2000ms | 120 | /monsters/XieZi.gif |

（HP 区间照录血量大全；攻防/攻速/经验为 MVP 手写值，集中在 json 可调）

### 技能（skills.json，照录技能表 xlsx 第 9/212 行）
| code | 名 | 职业 | 类型 | 数值 | SP | CD | 咏唱 |
|---|---|---|---|---|---|---|---|
| qiangli_daji | 强力打击 | warrior | next_hit_bonus | 下一次出手伤害 +10 | 25 | 5000ms | 0 |
| huoqiu_shu | 火球术 | mage | direct_damage | 17~23 火焰伤害（同样走 闪避→暴击→+atk−def 管线） | 20 | 0 | 5000ms |

- 技能=强化下一次出手（设计决策 #4）：激活时校验并**立即扣 SP、进 CD**；下次玩家行动改为技能结算
- 引擎支持通用控制（`stunUntil`，昏迷期跳过出手），MVP 两技能无控制，用**合成技能夹具**单测覆盖（验收要求）

### 单次行动结算顺序（引擎唯一真源）
`命中判定（1−闪避）→ 暴击判定 → 伤害 = max(1, roll + atk − def)（暴击 ×1.5 取整）→ 回血 → 死亡判定`
平局：行动只在 `t < startedAt + 180000` 内推进，超时无胜负 → draw。

---

### Task 0: 清理与启动数据库

- [ ] 删除根目录临时文件 `_tmp_dump_xlsx.py`、`_tmp_monsters.txt`、`_tmp_skills.txt`、`_tmp_npcpos.txt`（写计划时生成的，不入库）
- [ ] `pnpm db:up` 确认 MySQL 可用（后续 db 测试依赖；若已在跑则跳过）

### Task 1: 静态数据 monsters/skills/牧野草原地图 + schema 校验 + loader ✅（31db09a + 405aee4 + ffa27dd，两阶段评审通过）

**Files:**
- Create: `server/data/monsters.json`（上表 4 条）
- Create: `server/data/skills.json`（上表 2 条）
- Modify: `server/data/maps.json`（新增 `muye_caoyuan` 地图 38 节点；猫隐村 muye03 解锁并加 exit，数据规格见下方「牧野草原数据」）
- Modify: `server/src/data/schemas.ts`（新增 MonsterSchema/SkillsFileSchema；MapNodeSchema 增 `adjacent?: string[]`、`exit?: {map,node}`、`spawns?: string[]`）
- Modify: `server/src/data/loader.ts`（monsterIndex/skillIndex，风格照 petIndex）
- Test: `server/test/unit/data.test.ts`（扩展）

- [ ] **Step 1** 写失败单测：monsters/skills 通过 zod 校验；地图新字段交叉引用合法（adjacent/exit/spawns 引用的 code 必须存在、节点 code 全局唯一）；**牧野草原 38 格从 my_rukou 出发 BFS 全可达**
- [ ] **Step 2** `pnpm --filter maoyouji-server test` 确认失败
- [ ] **Step 3** 实现 schemas/loader（MapsFileSchema.superRefine 扩展：全局节点唯一 + adjacent/exit 交叉引用；spawns 引用 monsterIndex 校验放在 loader 层避免循环依赖）
- [ ] **Step 4** 写 monsters.json / skills.json / maps.json 牧野草原部分；**同步修正被 muye03 解锁打破的既有断言**（`test/unit/data.test.ts` 中「猫隐村锁定节点计数」类用例——解锁后锁定数为 0）；跑测试通过
- [ ] **Step 5** Commit `feat: 怪物技能静态数据与牧野草原地图及校验`

**牧野草原数据（maps.json 锁定，坐标照抄 `D:\maoyouji\测试\牧野草原.html` 的 LOCS，800×600 画布）：**
- 新地图 `muye_caoyuan`：type=field，name=牧野草原，background=/maps/muyecaoyuan.jpg（图片复制放 Task 7），spawnNodeCode=my_rukou
- 猫隐村 `muye03` 节点：删 `locked/lockedReason`，加 `"exit": { "map": "muye_caoyuan", "node": "my_rukou" }`
- 38 节点：`my00`~`my36`（**无 my19、my29**，short 用 "00"~"36"，name 用「牧野草原00」式）+ 3 边界：
  - `my_rukou`（name=村口，short=猫隐村）`"exit": { "map": "maoyin_village", "node": "muye03" }`
  - `my_wanma`（name=万马草原口，short=万马草原）`locked: true`（下张地图，二期）
  - `my_aolin`（name=矮林边界，short=低矮林地）`locked: true`（下张地图，二期）
- 坐标（code → x,y）：my00:292,44；my01:378,54；my02:455,78；my03:667,193；my04:145,161；my05:213,98；my06:111,79；my07:284,115；my08:115,234；my09:328,358；my10:271,181；my11:354,172；my12:445,179；my13:542,162；my14:603,264；my15:29,285；my16:152,287；my17:379,260；my18:534,297；my20:78,356；my21:184,424；my22:281,402；my23:390,384；my24:449,307；my25:568,339；my26:83,441；my27:547,407；my28:663,413；my30:125,499；my31:203,512；my32:285,504；my33:419,487；my34:569,473；my35:673,483；my36:488,457；my_rukou:700,108；my_wanma:17,19；my_aolin:704,527
- 边界节点坐标超界说明：原型按百分比定位（x/800, y/600），超 800/600 的值（如 my_rukou 700,108 未超；my_aolin 704,527 未超）——均未超界，照抄即可；schemas 的 x/y 上限 2000 已容纳
- 邻接表（按官方标注版地图石板路标定，BFS 测试守护连通性）：
  my_rukou:[my03]；my03:[my_rukou,my13,my14]；my13:[my03,my02,my12,my14]；my02:[my01,my13]；my01:[my00,my02]；my00:[my01,my07]；my07:[my00,my05,my10]；my05:[my06,my07,my04]；my06:[my05,my_wanma]；my04:[my05,my08]；my08:[my04,my15]；my15:[my08,my16,my20]；my16:[my15,my20]；my20:[my15,my16,my26]；my26:[my20,my21,my30]；my21:[my26,my22,my30,my32]；my30:[my26,my21,my31]；my31:[my30,my32]；my32:[my31,my21,my22,my33]；my22:[my21,my32,my09]；my09:[my22,my23]；my23:[my09,my24]；my24:[my23,my17,my18]；my17:[my24,my12]；my12:[my17,my11,my13]；my11:[my12,my10]；my10:[my11,my07]；my14:[my13,my03,my18]；my18:[my14,my24,my25]；my25:[my18,my27,my28]；my27:[my25,my36]；my36:[my27,my33,my34]；my33:[my36,my32]；my34:[my36,my35]；my35:[my34,my28,my_aolin]；my28:[my25,my35]；my_wanma:[my06]；my_aolin:[my35]
- 刷怪分区（`spawns` 字段，均匀随机）：近村 A=[my00,my01,my02,my03,my07,my10,my11,my12,my13,my14]→["lvmaochong","xiaoji"]；中路 B=[my04,my05,my06,my08,my15,my16,my17,my18,my20,my21,my24,my25,my26]→["xiaoji","hongmogu"]；远村 C=[my09,my22,my23,my27,my28,my30,my31,my32,my33,my34,my35,my36]→["hongmogu","caoyuanxie"]；my_rukou 无怪（入口安全），my_wanma/my_aolin locked 无怪
- 节点 npcs：牧野草原节点一律空数组 `[]`（怪物是运行时实例，非静态 NPC；小牧童等 NPC 原版数据留任务切片再补）

### Task 2: 迁移 003（battles + map_node_monsters）✅（0cc291e + 313ecb4 血量列改INT，两阶段评审通过）

**Files:**
- Create: `db/migrations/003_battle.sql`（头注释风格照 002）
- Modify: `server/test/db/helpers.ts` resetDb 加清 `battles`、`map_node_monsters`
- Modify: `server/test/db/schema.test.ts` 表清单 10→12 张

```sql
-- 003 要点（完整文件实现时写全，含 001 同款 created_at/updated_at/外键注释）
-- 注意建表顺序：先 map_node_monsters 后 battles（battles 有外键引用它）
-- 注意：hp/max_hp 用 INT UNSIGNED（质量评审决议：血量大全 xlsx 中 Boss 血量最高 265,900，
-- SMALLINT UNSIGNED 上限 65,535 装不下，切片 8 全量导入会炸；与 001 characters.hp 选型一致）
CREATE TABLE map_node_monsters (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  map_code VARCHAR(64) NOT NULL,
  node_code VARCHAR(64) NOT NULL,
  monster_code VARCHAR(64) NOT NULL,
  hp INT UNSIGNED NOT NULL,
  max_hp INT UNSIGNED NOT NULL,
  status ENUM('alive','dead') NOT NULL DEFAULT 'alive',
  respawn_at DATETIME(0) NULL COMMENT '死亡后 30s 可复活（惰性：轮询时刷新）',
  INDEX idx_mnm_node (map_code, node_code, status)
) COMMENT='每格怪物实例（进入格子惰性生成，无外键）';
CREATE TABLE battles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  character_id BIGINT UNSIGNED NOT NULL,
  monster_instance_id BIGINT UNSIGNED NOT NULL,
  monster_code VARCHAR(64) NOT NULL COMMENT '怪物编码（静态数据 monsters.json 键）',
  status ENUM('active','finished') NOT NULL DEFAULT 'active',
  result ENUM('victory','defeat','draw') NULL,
  state JSON NOT NULL COMMENT '战斗状态快照（engine.ts BattleState），含种子RNG/时间线/事件流',
  started_at DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME(0) NULL,
  INDEX idx_battles_character (character_id, status),
  CONSTRAINT fk_battles_character FOREIGN KEY (character_id) REFERENCES characters(id),
  CONSTRAINT fk_battles_monster FOREIGN KEY (monster_instance_id) REFERENCES map_node_monsters(id)
) COMMENT='战斗（惰性结算，状态在 state JSON）';
-- 注意：同一角色同时最多一场 active 战斗由应用层事务保证（SELECT characters 行 FOR UPDATE 后查 active），
-- 不建 (character_id,status) 唯一键（finished 多行会冲突）。
```

- [ ] **Step 1** 改 schema.test.ts 表清单断言（+battles、+map_node_monsters），确认失败
- [ ] **Step 2** 写 003_battle.sql；手动灌入现有开发库：`docker exec -i maoyouji-mysql mysql -uroot -pmaoyouji_root maoyouji < db/migrations/003_battle.sql`
- [ ] **Step 3** resetDb 同步补两张表
- [ ] **Step 4** `pnpm --filter maoyouji-server exec vitest run test/db/schema.test.ts` 通过
- [ ] **Step 5** Commit `feat: 战斗与刷怪运行时表迁移003`

### Task 3: 纯函数层 rng + rules（TDD 核心）✅（faa228f，两阶段评审通过；2 条 Minor 移入 Task 6）

**Files:**
- Create: `server/src/game/rng.ts`（mulberry32：`createRng(seed)` 返回 `{ next(): number [0,1), int(min,max): number, state: number }`）
- Create: `server/src/game/rules.ts`（派生属性/经验/升级/惰性恢复，全纯函数）
- Test: `server/test/unit/game/rules.test.ts`、`server/test/unit/game/rng.test.ts`

rules.ts 导出（签名锁定）：
```ts
export function hpMaxOf(level: number, vit: number): number
export function spMaxOf(level: number, intel: number): number
export function atkOf(profession: "warrior"|"mage", str: number, intel: number): number
export function defOf(agi: number): number            // floor(agi*1.5)
export function dodgeOf(agi: number): number          // min(0.4, agi*0.003)
export const BASE_CRIT = 0.05; export const CRIT_MULT = 1.5;
export const PLAYER_ATTACK_MS = { warrior: 2000, mage: 2200 };
export const UNARMED_MIN = 1; export const UNARMED_MAX = 3;
export function expNeedOf(level: number): number      // floor(100*L^1.5)
export function statGainOf(growth: number, newLevel: number): number // floor(g*L)-floor(g*(L-1))
export function applyLevelUps(p: {level,exp,vit,str,agi,intel,spr,hp,sp,profession,growth}, gained: number):
  { level,exp,vit,str,agi,intel,spr,hp,sp, leveledTo: number|null }  // 循环升；hp/sp 加上限增量
export function lazyRegen(p: {hp,sp,maxHp,maxSp,spr,intel,resourcesUpdatedAt: number}, nowMs: number):
  { hp, sp }   // 5s 一跳，见数值决策
```
- [ ] **Step 1** 写失败单测：expNeed(1)=100/expNeed(2)=282（floor(100×2^1.5)=282，勿用 round）；statGainOf(0.6,2)=1 且 (0.6,3)=0；applyLevelUps 连升+主属性+1+上限增量；lazyRegen 跨 17s 的期望值、封顶不溢出
- [ ] **Step 2** 跑失败 → **Step 3** 实现 → **Step 4** 跑通过
- [ ] **Step 5** Commit `feat: 战斗数值纯函数层(成长/经验/惰性恢复)`

### Task 4: 战斗引擎纯函数 engine（TDD 核心）✅（30b8614 + 3403629 加固，两阶段评审通过；集成纪律已移入 Task 6）

**Files:**
- Create: `server/src/game/engine.ts`
- Test: `server/test/unit/game/engine.test.ts`

核心类型与签名（锁定）：
```ts
export interface Combatant { name; sprite; level; hp; maxHp; sp?; maxSp?; atk; def; dodge; crit; critMult;
  intervalMs; spr; stunUntil: number; nextActAt: number }
export interface BattleState {
  v: 1; seed: number; startedAt: number; now: number;
  me: Combatant; foe: Combatant;
  pendingSkill: { code; name; kind: "next_hit_bonus"|"direct_damage"; bonusDamage?; dmgMin?; dmgMax?; stunMs? } | null;
  skillCdUntil: number; foeExp: number; seq: number; events: BattleEvent[];
  over: null | { result: "victory"|"defeat"|"draw"; expGained?: number };
}
export interface BattleEvent { seq; t; side: "me"|"foe"; kind: "hit"|"crit"|"miss"|"skill"|"stun"|"regen"|"end"; amount?; text: string }
export function createBattleState(input: {...}, seed: number, nowMs: number): BattleState
export function advance(state: BattleState, targetMs: number): BattleState   // 返回新对象（纯函数），内部快进
export function activateSkill(state: BattleState, skill: {...}, nowMs: number): { ok: true; state: BattleState } | { ok: false; reason: string }
// ↑ ok 分支带新 state（Task 4 修订）：纯函数不改入参，标记结果必须经返回值传出，Task 6 据此拿快照回写 battles.state
```
行为规格：
- `advance` 按 `nextActAt` 时间序逐行动作；行动时先判 `stunUntil > t` → stun 事件并顺延（`nextActAt = stunUntil`，昏迷结束即行动）；未昏迷则行动后 `nextActAt += intervalMs`、回 HP regen（每回合 `floor(1+spr×0.5)` 封顶 maxHp，增量 >0 才发 regen 事件）
- 同刻行动 me 先手（排序键 `(nextActAt, side: me<foe)`）；RNG 消耗顺序锁定：命中判定（`next() < 1-dodge`）→ 暴击判定 → 伤害 `int(min,max)` roll——单测夹具依赖此顺序
- `createBattleState` 输入含双方 Combatant 全量数值 + `foeExp`（怪物经验，victory 时作 expGained）；双方初始 `nextActAt = nowMs + intervalMs`
- 玩家行动时若有 `pendingSkill`：next_hit_bonus = 徒手 roll + bonusDamage；direct_damage = roll(dmgMin,dmgMax)；均走 闪避→暴击→`max(1, roll+atk−def)` 管线，结算后清空 pendingSkill
- 事件 `text` 服务端预生成中文（如「你对 草原蝎 发动了强力打击，造成 14 点伤害！」「绿毛虫 发动攻击，你闪避了！」）
- `t >= startedAt+180000` 停止推进：分出胜负记 `end`，否则 draw（expGained 仅 victory 有值 = 怪物 exp，来自 createBattleState 输入）
- RNG：每次 `advance` 用 `state.seed` 新建，结束时回写 `state.seed`；同种子同输入 → 事件序列完全一致（单测断言两次跑 events 深度相等）

单测清单（验收逐条）：命中（必中夹具）/ 闪避 / 暴击倍率取整 / 控制昏迷跳过并顺延 / 击杀 victory+expGained / 被击杀 defeat / 3 分钟 draw / 技能强化一击后恢复普攻 / activateSkill 的 SP 不足·CD 中·重复激活拒绝 / 同种子确定性。
- [ ] **Step 1** 失败单测 → **Step 2** 失败 → **Step 3** 实现 → **Step 4** 通过
- [ ] **Step 5** Commit `feat: 战斗结算器纯函数(快进时间线/技能强化/控制/平局)`

### Task 5: 牧野草原地图接入 + 刷怪 + map 路由改造 ✅（3b2d08e + 04cb076 + 65a9856 + 8786bc9，两阶段评审通过；野外出口相邻限制经收口恢复）

**Files:**
- Modify: `server/src/data/loader.ts`（nodeIndex：全局 code → {mapCode, node}；地图数据已在 Task 1 入库）
- Modify: `server/src/routes/map.ts`（双图 / 相邻格 / 跨图出口 / 刷怪钩子 / 怪物列表下发）
- Create: `server/src/game/spawn.ts`（刷怪/复活惰性逻辑）
- Test: `server/test/db/map.test.ts`（扩展）

行为规格：
- **跨图出口（传送门）**：目标节点带 `exit` 时→城镇内任意位置可点、野外需与当前格相邻→直接落至 `exit.node`（**从不站立在边界节点上**；玩家站在出口节点上再点它是 no-op，防弹回）。地图切换后返回新地图视图
- **野外相邻移动**：field 图内目标必须在 `currentNode.adjacent` 内；城镇维持自由移动
- **刷怪**（`spawn.ts`，幂等）：进入/查看带 spawns 的格子时——该格无实例→随机 2~4 只（类型均匀随机、HP 区间内随机）INSERT；有实例且全部死亡→将 `respawn_at <= NOW()` 的死亡实例复活（回满随机重 roll HP）；死亡未到 30s 的保持尸体
- **GET /map/current**：按角色当前节点反查所属地图；field 图节点附带 `monsters: [{id, code, name, hp, maxHp, level, sprite}]`（仅 alive）；响应时对全图做一次惰性复活扫描
- **POST /move**：战斗中 409 拒绝

db 测试：村口 muye03 跨图进草原落在 my_rukou；**返程：在草原与 my_rukou 相邻的格子点 my_rukou → 落回猫隐村 muye03（双向）**；野外非相邻移动 400、相邻通过；进 A 区格子后 current 出现怪物实例；杀怪（直接 UPDATE status=dead, respawn_at=过去）后 current 复活；战斗中移动 409（该条放 Task 6 一起也行）。
**同步修正两条既有断言（Task 1 地图数据落地后被打破）**：`test/unit/data.test.ts` 中「猫隐村锁定节点计数」类断言（muye03 已解锁）、`test/db/map.test.ts` 中「muye03 锁定返回 400/下一切片」用例——实现 Task 5 时若发现类似断言一并更新。
- [ ] 复照 TDD 节奏（失败单测→实现→通过），分 2 次提交：`feat: 牧野草原地图与野外相邻移动`、`feat: 格子惰性刷怪与复活`

### Task 6: 战斗 API（start / state / skill）+ 结算副作用 ✅（f45d1c1 + 7c5ae1b + 6901a06，两阶段评审通过；前端契约清单已移入 Task 7）

**Files:**
- Create: `server/src/routes/battle.ts`，注册进 `app.ts`（prefix `/api/battle`）
- Test: `server/test/db/battle.test.ts`

路由规格：
- `POST /start` `{monsterInstanceId}`：事务内 `SELECT ... FROM characters WHERE id=? FOR UPDATE` → 校验无 active 战斗、怪物 alive 且在本角色当前格 → `lazyRegen` 补状态 → `createBattleState`（玩家：按 rules 派生 + 当前 HP/SP；怪：实例 HP + monsters.json 派生；seed=Math.random 派生 32 位）→ INSERT battles → 返回初始 state。**同时对该怪物实例行 `SELECT ... FOR UPDATE`**（防双账号同格同时点同一只活怪各自开战重复结算；质量评审决议）
- **结算临界区（防并发双结算，1s 轮询与 /skill 可并发）**：advance 与结算的落库统一走单一函数，事务内先 `SELECT ... FROM battles WHERE id=? FOR UPDATE` 锁行、**复查 `status='active'`**（已被并发请求结算过则直接返回现状态），再 advance+结算+UPDATE；`GET /state` 与 `POST /skill` 共用该路径
- `GET /state?sinceSeq=N`：读 active 战斗（**无 active 战斗返回 404 `{message:"当前没有进行中的战斗"}`，前端据此关闭覆盖层/不进入战斗态**）→ advance(Date.now()) → 未结束回写 state；已分胜负则按上方临界区结算：
  - victory：怪 `status=dead, respawn_at=NOW()+30s`；`applyLevelUps` 更新角色（exp/五维；**HP/SP 取战斗结束时的 `state.me.hp/sp`**，各加上限增量并封顶新上限，不得用库中战前旧值）+ `character_monster_stats` UPSERT（kill_count+1、total_exp_gained+exp）。**升级封顶：rules.ts 增加 `MAX_LEVEL = 90` 导出，applyLevelUps 循环条件加 `level < MAX_LEVEL`（规则设计 §3.4；质量评审决议），同步补单测：满级喂经验不再升级**；顺手把 `routes/characters.ts` 创建角色处的手写派生公式替换为 `hpMaxOf/spMaxOf`（同包 2 行，防公式单点漂移）
  - defeat：角色回 `jiaotang`、HP/SP 回满、`resources_updated_at=NOW()`；怪回满血复活（status=alive）
  - draw：怪回满血复活；角色 `resources_updated_at=NOW()`
  - battles `status=finished/result/ended_at`；响应带 `over`
- 响应均 `{state: {hp,maxHp,sp,maxSp,foeHp,foeMaxHp,foeMaxSp?,foeName,foeSprite,pendingSkill,skillCdUntil,now,over}, events: [seq>N 的增量]}`（foeName/foeSprite 为 Task 7 修订：恢复战斗时前端直接取用，不靠 HP 匹配推断）
- `POST /skill` `{code}`：校验 preset 技能匹配职业 → advance(now)（若这一下打出胜负，同样走结算临界区）→ `activateSkill` → 回写 state（SP 扣减/CD 在 state 内）
- 技能校验口径（MVP）：**preset 技能按职业直接可用**，不查 character_skills（切片 5+ 接技能学习后替换）
- **咏唱语义**：activateSkill 将 `nextActAt = max(nextActAt, now+castMs)`（火球术即出手延后 5 秒），仅此而已；前端不做施法条，只显示「已强化/咏唱中」高亮
- **集成纪律（Task 4 质量评审产出，实现时照做）**：① 时钟源统一只用 `Date.now()`，startedAt 不得取 DB NOW()（3 分钟 cap 会漂移）；② 顺序固定「先 `advance(state, Date.now())` 再 `activateSkill`」，激活成功持久化 `r.state`（先激活会吞掉 now 前应发生的一次普攻）；③ over 后 advance 是安全 no-op，读到 over 即终局分支（victory 按 expGained 结算），停止回写；④ `sinceSeq` 增量在路由侧 `events.filter(e => e.seq > sinceSeq)`，勿发全量（终局 60-100KB）；events 全量驻留 state 是刻意设计，勿截断；⑤ state 新增字段只用 JSON 原生类型（禁 Date/Map/Set），改 state 形状必须补 JSON 往返守卫测试；⑥ activateSkill 成功分支签名 `{ ok: true; state }`（Task 4 修订）；⑦ 单写者纪律由结算临界区保证（见上），同 targetMs 重放幂等已实测

db 测试（app.inject 全链路）：发 起→轮询推进（hp 变化/事件增量）→ 3 分钟平局（`JSON_SET(state,'$.startedAt', 过去)` 后轮询→draw+怪回满）→ 胜利路径（直接 JSON_SET 把怪 hp 压到 1、玩家攻高夹具？——用真角色打绿毛虫多轮询几次到 victory，断言 exp/monster_stats/怪尸体）→ 失败路径（角色 hp 压到 1 打草原蝎→defeat→角色落教堂满血）→ 战斗中 move 409、重复 start 409、skill SP 不足 400。
- [ ] TDD 节奏，Commit `feat: 战斗API与惰性结算(经验/复活/平局)`

**Task 6 集成纪律（Task 5 质量评审产出）**：① /start 先对当前格 `spawnForNode`（与 /current 同语义），再选 alive 实例；全灭未到 30s 明确拒绝（409「怪物尚未刷新」），spawnForNode 不会提前复活；② **实例 hp 是权威值**：state 快照 `map_node_monsters.hp/max_hp`，绝不从 monsters.json 重派生 hp；alive 校验落 DB 行 `WHERE id=? AND status='alive'`（防 check-then-act 被复活扫描改状态）；③ 击杀写 `respawn_at = DATE_ADD(NOW(), INTERVAL 30 SECOND)`（DB 侧算术，与复活扫描同钟）；④ **软锁风险**：active 战斗 >3 分钟后 /move 一直 409，除非战斗路由先惰性结算——所有战斗路由（含 /state 轮询）都先跑到期结算；/move 的 409 响应带 `battleId` 让前端导回战斗视图；⑤ 保留实例行（尸体+复活）维持 battles FK，**不要删实例行**；⑥ /start 按 id 选实例时对 `monster_code` 做 `monsterIndex().has()` 兜底校验（与视图层幽灵行消毒同口径，防旁路 id 进战斗构造崩溃）

### Task 7: 前端战斗覆盖层 + 技能栏联动 ✅（2613043 + a1abc4a + 7e74430，两阶段评审通过：规格 13 条契约逐条定位 + 质量 1 Important/3 Minor 修复复核）

**Files:**
- Copy 素材：`assets/怪物/{LuMaoChong,XiaoJi,mogu2,XieZi}.gif → web/public/monsters/`；`assets/战斗背景/muyecaoyuan.gif → web/public/battle/`；`assets/地图/牧野草原/牧野草原-官方预览图.jpg → web/public/maps/muyecaoyuan.jpg`
- **注意（Task 5 产出）**：POST /move 同图返回 `{node:{code,name,short}}`、跨图返回完整新图视图（MapCurrent 结构）——web 的 move 处理需按响应有无 `nodes` 字段分流：有则整体替换地图视图，无则仅更新 currentNodeCode；current 的 field 节点带 `monsters` 数组（城镇节点无该字段）
- Modify: `web/src/api.ts`（MapNode+monsters、BattleState/BattleEvent 类型、battleStart/battleState/battleSkill）
- Modify: `web/src/App.vue`（给 GameShell 传 `:character="current"` **并加 `@character-changed="refresh"` 监听**，否则升级后角色数据不刷新）
- Modify: `web/src/components/GameShell.vue`
- Test: `pnpm --filter maoyouji-web build`（vue-tsc 类型门禁）

GameShell 规格（视觉基准：旧仓库原型 `D:\maoyouji\测试\游戏主界面.html` #battle 段——血条置顶四角、双方形象底部左右、伤害飘字、muyecaoyuan.gif 铺满）：
- NPC 面板：当前格怪物列表（绿名+HP），点击 → `battleStart` → 进战斗态（1s 轮询 `battleState(sinceSeq)`，并发防护照聊天轮询写法）
- **战斗恢复（防软锁死）**：GameShell 挂载/`load()` 后先 `GET /api/battle/state`（**sinceSeq=-1**——过滤是 `seq>sinceSeq` 严格大于，seq 从 0 起，传 0 会丢首条事件；Task 6 质量评审更正）——404 视为无战斗；200 则直接恢复战斗态+轮询。这样刷新页面/换角色再进不会把角色永久留在一场没人推进的战斗里
- 战斗覆盖层：absolute 铺满 `.scene`；左上我方名+HP/SP条（渐变绿/蓝照原型）、右上怪物名+HP条；底部左 `petGif` 右怪物 gif；事件→飘字（受击方位置，红伤害/灰「闪避」/橙暴击放大）+ 聊天记录行（你=红 `#F52627`、怪名=绿下划线，格式照原型注释）
- 技能栏联动：slot 0 = 职业 preset 技能（名+SP 角标）；战斗中可点 → `battleSkill`；`skillCdUntil` 期间深色扫过 CD 遮罩、`pendingSkill` 存在时高亮「已强化」；SP 不足置灰；快捷键 `1` 触发（keydown 守卫 isComposing/repeat，照聊天输入）
- 结算：`over` → 中央横幅（胜利·获得 X 经验 / 不分胜负 / 战败）/ 失败显示「回到猫隐村教堂」；3s 后关覆盖层 → 重新 `load()` 地图（怪物尸体/复活可见）+ emit `character-changed` 让 App 刷新角色（升级即时反映）
- 移动入口：战斗中覆盖层挡住地图，天然防点
- [ ] 实现后 `pnpm --filter maoyouji-web build` 零错误；Commit `web: 战斗覆盖层与技能栏联动`

**Task 6 质量评审产出的前端契约（实现照做）**：① events 的 `side` 是**出手方**，飘字落受击方位置；`text` 服务端中文直接展示；kind 驱动样式（红伤害/灰闪避/橙暴击放大）；② 409 分流**看 body.battleId 而非状态码**：/move「战斗中无法移动」与 /start「已有进行中的战斗」带 battleId → 导回战斗视图恢复轮询；/start「该怪物正在被挑战」「怪物尚未刷新」不带 → 仅 toast；③ api.ts `request<T>` 现 throw 无 status/body 的 Error，需类型化错误（带 status/body）才能实现②；新增 BattleState/BattleEvent 类型与 battleStart/battleState/battleSkill（均支持 sinceSeq）；④ CD 遮罩倒计时以 `state.now + (本地 Date.now() − 收包时刻)` 为基准，勿拿 skillCdUntil 直接比本地时钟；⑤ /skill 可能 200 + over 非空（这一击打出胜负，技能未激活 SP 未扣）→ 按终局处理；激活被拒 400 message 可直接 toast；⑥ 刷新时机：/start 成功后刷新角色面板（服务端 lazyRegen 可能已回血）；任一 over 后重拉 /map/current（胜利杀实例/失败传送教堂）+ `@character-changed`；⑦ me.sprite 为空串，我方形象前端自选宠物 gif；foe.sprite 即 /monsters/*.gif

**Task 7 质量评审遗留项（修复中）**：
- Important：战斗日志怪名高亮读活值 `battle.value?.foeName`，战后置 null 导致历史行确定性褪色 → push 时烘焙 `parts`（applyBattle/开战行均在 foeName 就位后消费）
- Minor ×3：`battle.value = res.state` 前加 now 单调守卫（防乱序回退血条）；`!battleActive` 分支首行加 `if (res.state.over) return;`（防终局响应复活已收摊战斗）；GameShell `PRESET_SKILL` 与 skills.json 双源 → 仅加同步注释（只读 skills 端点留给切片 8 xlsx 导入时一并考虑，勿提前建设）
- 已核查无问题（勿重复排查）：BIGINT battleId 范围内回 JS number、battleEnding 双闸覆盖横幅窗口、响应式整包替换无漏渲染

**GameShell 拆分备忘（切片 5 前低风险重构项，本切片不动）**：现 1134 行（战斗 +650）已到拆分阈值。务实路径：抽 `useBattle.ts` 组合式函数（battle refs + applyBattle/pollBattle/castPreset/settlement 约 250 行 script，模板耦合面窄，emit 以回调注入）；`BattleLayer.vue` 为可选第二步。收益：竞态守卫可上 vitest 单测；切片 5/6 还要继续往该文件加东西。纯搬移不改行为，1400×832 手动回归一次即可。

### Task 8: 全量回归 + 手动验收 + 文档

- [ ] `pnpm test`（server 单测 + web）与 `pnpm --filter maoyouji-server test:db` 全绿
- [ ] `pnpm dev` 起双端，按 1400×832 手动回归三路验收（设计文档验收标准）：
  1. **胜**：村口→牧野草原03→相邻走到 A 区→点绿毛虫→技能「强力打击」→胜利横幅+经验到账（怪物斩杀数可从 character_monster_stats 查证）
  2. **败**：低血量（或直接打草原蝎）→ 战败 → 回猫隐村教堂、HP/SP 满
  3. **平**：挂机 3 分钟 → 不分胜负脱战、无得失
  4. 野外非相邻格点击移动被拒；战斗中地图不可点；地图切换双向（村⇄草原）
- [ ] 更新 `docs/开发共识.md` 切片清单勾掉 4；CLAUDE.md「实施切片」行同步；Commit `docs: 切片4战斗引擎完成记录`

---

## 风险与回退
- 结算器是最高风险项：Task 3/4 纯函数+固定种子，测试不过不进 Task 5/6
- db 测试时间依赖（3 分钟平局/30s 复活）一律通过改库内 JSON/respawn_at 模拟时间流逝，不 sleep
- 素材缺失：泡泡/黑蘑菇无精灵图，不上（已在上表锁定 4 怪）；红蘑菇与黑蘑菇共用 mogu2 的问题随切片 8 素材导入解决
- 38 格邻接为人工标定，BFS 连通性测试守护「全图可达」；个别边与原版有出入不阻塞，后续按官方图微调

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概况

《喵游记》——2008 年页游《猫游记》的复刻，当前目标是单机核心循环 MVP：注册 → 建角色（17 宠物 × 战士/法师）→ 猫隐村走格子 → 打怪 → 掉落 → 背包装备 → 新手任务 → 升到 10 级。聊天/组队/交易/PK 等社交系统全部二期。

仓库语言为中文：代码注释、文档、commit message、用户可见文案均用中文，commit 格式为 `type: 中文描述`（如 `feat:`、`web:`、`docs:`）。

## 常用命令

```powershell
pnpm install
pnpm db:up                                # 启动 MySQL 8（docker compose，宿主机端口 13306）
pnpm dev                                  # 并行启动 server(:3000) 与 web(:5173)
pnpm test                                 # 全部单测（server 单测 + web；不依赖数据库）
pnpm --filter maoyouji-server test:db     # 连库测试（需先 db:up）
pnpm --filter maoyouji-server exec vitest run test/db/map.test.ts   # 跑单个测试文件
pnpm --filter maoyouji-web build          # vue-tsc 类型检查 + vite build
```

注意：docker compose 只在**首次建卷**时自动执行 `db/migrations/`；新增迁移文件后要对已存在的开发库手动灌入（或 `pnpm db:reset` 清卷重建，会丢数据）。

## 架构

pnpm monorepo，两个 workspace 包：`server/`（Fastify 5 + TS + mysql2 手写 SQL，无 ORM）与 `web/`（Vue 3 + Vite）。权威决策记录在 `docs/开发共识.md`，动手前先读。

### 静态数据与运行时状态严格分离（核心决策）

- **静态配置不进数据库**：`server/data/*.json` 按域拆分（pets/maps/…），字符串 `code` 主键。服务启动时经 zod 校验（`src/data/schemas.ts`）+ 交叉引用检查，失败拒绝启动（`src/data/loader.ts` 提供模块级缓存索引）。
- **MySQL 只存运行时状态**：`db/migrations/001_init.sql` 是运行时 schema 的唯一主权。运行时表引用静态数据一律用 VARCHAR code 列（应用层兜底校验），运行时表之间保留物理外键。
- `docs/数据库设计.md` 是 **v1 遗留文档**（描述已废弃的 cfg_ 表方案），仅作历史参考，勿据其写代码。

### 其他关键设计

- **战斗惰性结算**（切片 4，最高风险项）：状态持久化、服务器零定时器；前端 1s 轮询触发时间线快进，技能 = POST 指令，3 分钟上限在结算时判定。战斗结算器要求纯函数化 + 固定种子 RNG 以便单测。战斗外 HP/SP 恢复按 `characters.resources_updated_at` 时间差惰性补算。
- **认证**：用户名 + 密码（argon2id）+ httpOnly cookie JWT（cookie 名 `mj_token`）。受保护路由用 `server/src/plugins/auth.ts` 的 `requireAccount` / `requireCharacter` preHandler；JWT payload 挂在 `req.account`。
- **路由**：全部挂 `/api` 前缀（app.ts），请求体用 zod `safeParse` 校验，错误统一 `{ message }` JSON。
- **前端**：`App.vue` 是视图状态机（loading→auth→select→game），`GameShell.vue` 是 1400×832 主界面框架，复刻原版视觉（原型参考 `prototype/`、界面结构 `docs/游戏界面结构参考.md`）。web 所有 API 调用集中在 `src/api.ts`，vite 将 `/api` 代理到 127.0.0.1:3000。零 CDN、零运行时联网。
- **素材**：`assets/` 存原版参考素材（授权见 `assets/来源与授权.md`），用到的精灵图复制进 `web/public/`。

## 实施切片与工作流

按 `docs/开发共识.md` 的切片顺序推进：1 脚手架 ✅ → 2 认证+角色 ✅ → 3 地图移动 ✅ → 4 战斗引擎（下一步）→ 5 掉落+背包 → 6 新手任务 → 7 前端面板 → 8 xlsx→JSON 导入。

每个切片先写实施计划（checkbox 任务清单，TDD 红绿节奏）存入 `docs/plans/` 或 `docs/superpowers/plans/`，设计规格存 `docs/superpowers/specs/`。实现按任务逐条推进并勾选。

## 测试约定

- server 测试分两组：`test/unit/`（`pnpm test` 跑）与 `test/db/`（`test:db` 跑，需连库），vitest 通过 exclude/include 区分。
- **db 测试共享同一个 MySQL 库**，`server/vitest.config.ts` 设了 `fileParallelism: false`（文件串行）；`test/db/helpers.ts` 的 `resetDb()` 负责清表——**新增表后必须同步更新它**和 `test/db/schema.test.ts` 的表清单断言。
- db 测试用 fastify `app.inject()` 走完整 HTTP 栈，cookie 用 `helpers.ts` 的 `cookieOf()` 提取。

## 其他约定

- server dev 运行器用 Node 原生 TS（`node --watch src/index.ts`），**import 必须显式带 `.ts` 扩展名**，不引入 tsx。
- UI 改动完成后按 1400×832 手动回归（原版界面基准尺寸）；多账号交互功能（如聊天）需双浏览器回归。
- `docs/游戏规则设计.md` 是游戏数值与规则的权威文档（v2.0）；`docs/` 下另有任务系统、NPC 全量数据、宠物技能等原版考据资料与 xlsx 数值表。

# MVP 切片 2：认证与角色 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 注册/登录/登出 + 建角色（17 宠物 × 战士/法师）+ 5 角色上限 + 选角，前端最简页面走通。

**Architecture:** JWT(HS256 手写, httpOnly cookie) 认证；角色初始属性按 `docs/游戏规则设计.md` §3.3 由 pets.json baseStats 派生；pets.json 为首个静态数据文件，引入 zod 启动校验模式（共识 #4）。

**Tech Stack:** zod、@node-rs/argon2（若安装失败退回 node:crypto scrypt 并更新共识）、@fastify/cookie、Vitest。

---

### Task 1: 依赖与静态数据加载器

**Files:** `server/package.json`、`server/data/pets.json`、`server/src/data/schemas.ts`、`server/src/data/loader.ts`、`server/test/unit/data.test.ts`

- [ ] pets.json：17 宠物 {code,name,baseStats(五维,和=25),growth(每级浮点,待平衡),sprite,description}
- [ ] zod schema + `loadPets()`：启动读取校验，重复 code / 总和≠25 拒绝
- [ ] 单测：合法文件通过；重复 code / 属性和≠25 抛错

### Task 2: JWT(HS256) 工具

**Files:** `server/src/lib/jwt.ts`、`server/test/unit/jwt.test.ts`

- [ ] `sign(payload,secret,ttlSec)`（iat/exp 自动）、`verify(token,secret)`：签名篡改→null、过期→null、正常→payload
- [ ] node:crypto timingSafeEqual 比较签名

### Task 3: 认证路由

**Files:** `server/src/routes/auth.ts`、`server/src/plugins/auth.ts`、`server/test/db/auth.test.ts`

- [ ] POST /api/auth/register：用户名 2-32、密码≥6；argon2id 哈希；重名 409；成功设 cookie
- [ ] POST /api/auth/login：密码错 401；成功更新 last_login_at 设 cookie
- [ ] POST /api/auth/logout：清 cookie
- [ ] GET /api/auth/me：未登录 401；已登录 {username, characterId}
- [ ] POST /api/auth/select-character {characterId}：非本人角色 403；成功重签含 characterId 的 token

### Task 4: 角色路由

**Files:** `server/src/routes/characters.ts`、`server/test/db/characters.test.ts`

- [ ] GET /api/characters：本人未软删角色列表
- [ ] POST /api/characters {name(2-16),breedCode,profession}：breedCode 不在 pets.json→400；第 6 个→400；重名→409；初始属性=baseStats，HP=50+vit*8+level*10，SP=30+intel*5+level*5
- [ ] DELETE /api/characters/:id：软删 + 改名 `#<id>#<原名>` 释放昵称（DB 设计约定）
- [ ] db 测试 beforeAll：SET FOREIGN_KEY_CHECKS=0 清两张表再恢复

### Task 5: 前端最简页面

**Files:** `web/src/App.vue`、`web/src/api.ts`

- [ ] 未登录：注册/登录表单切换
- [ ] 已登录未选角：角色列表 + 创建表单（宠物下拉 17 项 / 职业二选一）+ 进入按钮
- [ ] 已选角：显示角色名（占位主界面入口，切片 3 扩展）

### Task 6: 收尾

- [ ] `pnpm test` + `pnpm --filter maoyouji-server test:db` 全绿
- [ ] web build 成功
- [ ] commit：`feat: 认证与角色创建选角闭环`

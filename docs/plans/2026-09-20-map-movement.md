# MVP 切片 3：猫隐村地图与移动 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 玩家在猫隐村 20 地点的原版地图上点击移动，主界面 1400×832 框架落地。

**Architecture:** maps.json 静态数据（tools/gen-maps.mjs 合成生成）→ zod 启动校验 → GET/POST map API → Vue GameShell 消费。设计详见 `docs/superpowers/specs/2026-09-20-map-movement-design.md`。

### Task 1: 数据生成
- [ ] tools/gen-maps.mjs：locs 硬编码（原型坐标+拼音 code）× NPC json → server/data/maps.json
- [ ] 运行生成并人工抽查 3 个节点

### Task 2: schema/loader
- [ ] schemas.ts 增 MapNodeSchema/MapSchema/MapsFileSchema；loader.ts 增 loadMaps/mapIndex
- [ ] unit/data.test.ts 增 maps 校验用例（20 节点、code 唯一、广场存在、locked 唯一）

### Task 3: 后端路由与出生点
- [ ] characters POST 写 current_node_code='guangchang'；characters.test 断言出生点
- [ ] routes/map.ts：GET /api/map/current、POST /api/map/move（404/400/200）
- [ ] test/db/map.test.ts 三分支 + 未选角 400

### Task 4: 前端 GameShell
- [ ] 拷背景图 → web/public/maps/maoyin.jpg
- [ ] api.ts 增 mapCurrent/move；GameShell.vue 替换 GamePanel（顶栏/地图区/列表/消息窗/底栏）
- [ ] 移动消息进聊天记录；locked/错误 toast

### Task 5: 验证提交
- [ ] pnpm test + test:db 全绿；web build 绿
- [ ] 浏览器走查：进村→点击移动→标记跟随→消息流
- [ ] commit：`feat: 猫隐村地图移动与主界面框架`

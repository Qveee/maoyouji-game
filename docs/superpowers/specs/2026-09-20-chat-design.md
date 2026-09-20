# 聊天系统设计（2026-09-20 已获用户批准）

## 决策记录
- 送达机制选型 A：MySQL 持久化 + REST 轮询（符合开发共识第 6 条：状态进 MySQL、服务器零定时器、前端轮询）。WebSocket/SSE 违背轮询哲学；内存缓冲重启丢消息。
- 公会聊/队伍聊：频道类型在枚举与路由架构中预留，但输入行下拉**置灰禁用**（`<option disabled>`），等公会/队伍系统上线再接（共识将公会/队伍排二期，不为聊天单独发明最小成员模型）。
- 私聊目标：**手输对方角色名**（不做玩家列表面板点选，中间「玩家」面板维持空占位）。
- 消息路由：世界聊 → 右上「世界」窗口（面板标题由「世界·掉落公告」改名）；区域/私聊（及未来公会/队伍）→ 右侧「私人信息」窗口。
- 频道配色：区域 `#a05a00` 橙棕（新）、私聊 `#7030a0` 紫（新）、公会 `#178714` 绿（复用 NPC 标题绿，预留）、队伍 `#2b6fc4` 蓝（复用 NPC 标题蓝，预留）；世界窗内消息用默认墨色。
- 左下「聊天记录」面板保留，只收系统消息（欢迎、移动失败、发送报错），聊天不再本地回显。
- 世界聊限频：每角色每 10 秒一条，发送时惰性查上一条世界消息时间差校验，无定时器；顺带惰性清理 1 天前旧消息。

## 数据（db/migrations/002_chat.sql）
新表 `chat_messages`：
- `id` BIGINT UNSIGNED AUTO_INCREMENT PK
- `channel` ENUM('area','world','private','guild','team') — guild/team 预留不开放
- `sender_id` BIGINT UNSIGNED NOT NULL
- `sender_name` VARCHAR(32) NOT NULL（发送时角色名快照，免 join）
- `target_id` BIGINT UNSIGNED NULL / `target_name` VARCHAR(32) NULL（私聊专用）
- `node_code` VARCHAR(64) NULL（区域聊专用）
- `content` VARCHAR(60) NOT NULL（与前端 maxlength=60 一致）
- `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP（UTC，全表口径一致）
- 索引：`(sender_id, channel, created_at)` 世界限频查；`(node_code, id)` 区域轮询；`(target_id, id)` 私聊轮询

## 后端（server/src/routes/chat.ts，前缀 /api/chat，requireCharacter）
- `GET /messages?sinceId=N`
  - 带 `sinceId`：返回 `id > N` 且对我可见的消息，id 升序
  - 不带：返回对我可见的最新 50 条（id 倒序取 50 后正序输出）
  - 可见性：world → 所有人；area → `node_code = 我 current_node_code`；private → `sender_id = 我 OR target_id = 我`；guild/team → 预留永假分支
- `POST /send {channel, content, targetName?}`
  - zod：channel 枚举；content trim 后 1~60 字；private 必填 targetName
  - guild/team → 400「该频道暂未开放」
  - private：按角色名查目标（`name` 唯一、`deleted_at IS NULL`）→ 不存在 404「角色不存在」；目标=自己 400「不能私聊自己」
  - world：距我上一条 world 消息 <10 秒 → 400「世界频道每10秒只能发言一次」；随后惰性 `DELETE` created_at < 1 天前旧消息
  - area：落库 `node_code = 我当前节点`
  - 成功返回 `{ message: {id, channel, senderId, senderName, targetName?, content, createdAt} }`（`createdAt` 为 UTC 落库，前端用 `toLocaleTimeString` 转浏览器本地时间展示，与现有 `say()` 时间列一致）
- 错误码沿用现有风格：400/404 + `{message}`

## 前端（web/src/components/GameShell.vue）
- 轮询：onMounted 拉历史（不带 sinceId）→ 记录 maxId → `setInterval` 3 秒 `GET ?sinceId=maxId` 增量；onUnmounted 清除
- 频道下拉：区域/世界/私聊可选；公会/队伍 `<option disabled>` 置灰
- 私聊时输入行左侧出现 70px 目标名输入框（maxlength 32，placeholder「目标角色名」）
- 发送：POST /send；失败经 `say()` 系统提示进左下「聊天记录」；成功不本地回显，等轮询统一渲染（自己可见自己的消息）
- 渲染路由：world → 「世界」窗；其余 → 「私人信息」窗
- 消息格式：区域/世界 `名字：内容`；私聊 `你对 XX 说：内容`（我是发送方）/ `XX 对你说：内容`（我是接收方）；均带 time 前缀
- web/src/api.ts 补 `ChatMessage` 类型与 `chatMessages`/`chatSend` 两个方法

## 测试（Vitest）
- db 级（server/test/db/chat.test.ts，沿用现有 db 测试惯例）：
  - 区域消息：同节点角色可见、异节点不可见
  - 世界限频：10 秒内第二连发 400
  - 私聊：目标不存在 404；发送后双方 sinceId 轮询均可见；私聊自己 400
  - guild/team：400「暂未开放」
  - 增量：sinceId 只返回新消息；不带 sinceId 返回最新 50 条可见集
- 前端：按切片 7 惯例 1400×832 手动回归

## 范围外（明确不做）
- 公会/队伍成员关系与真实公聊/队聊路由（等对应系统）
- 玩家列表面板、在线状态、私聊会话分线程
- 聊天敏感词/管理禁言

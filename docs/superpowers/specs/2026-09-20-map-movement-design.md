# 切片 3 设计：猫隐村地图与移动（2026-09-20 已获用户批准）

## 决策记录
- 视觉基调 B：登录/选角=木框金门户风；**进入游戏后=浅蓝页游面板风**（规则文档 §11 权威基准）。
- 范围 B：完整猫隐村（20 地点）+ 1400×832 主界面框架 + 原版背景图 + 点击移动。NPC 只展示列表，交谈/任务留切片 6。

## 数据
- `server/data/maps.json`：猫隐村一图。节点 `{code(拼音), name, x, y, npcs[{name,title,titleColor}], locked?}`。
- 坐标取原型 `测试/游戏主界面.html` 的 `MAPS.猫隐村.locs`（已对官方预览图校准，标签中心）。
- NPC 取 `docs/猫隐村NPC全量数据.json` 的 npcs 字段（去 uid/raw/idx/chats，chats 留切片 6）。
- 出口节点 `牧野草原03`（去牧野草原）标 `locked:true`，移动返回 400「暂未开放」；西村口为村内地块不锁。
- 背景图：`assets/地图/猫隐村/猫隐村-官方预览图.jpg`（108KB）→ 拷入 `web/public/maps/maoyin.jpg`。
- 生成脚本 `tools/gen-maps.mjs` 合成两数据源（保留入库，切片 8 数据管线复用）。

## 后端
- zod：`MapsFileSchema`（code 唯一、npc 引用存在性由结构内联保证）。
- 出生点：`POST /api/characters` 写 `current_node_code='guangchang'`（猫隐村广场）。
- `GET /api/map/current`（需选角）：返回 `{map:{code,name,background}, nodes:[…含 current 标记]}`。
- `POST /api/map/move {toCode}`：节点不存在→404；locked→400；成功更新 `characters.current_node_code` 并返回节点。
- 城市自由移动（规则 §10）：不做邻接限制；野外相邻格规则留切片 4 后接牧野草原时实现。

## 前端（浅蓝页游风）
- `GameShell.vue`：1400×832 固定舞台居中。布局：顶栏 28px（菜单占位+服务器+角色名）｜左 600px 地图区+底部聊天记录｜中 290px NPC 列表+玩家列表（空态）｜右侧掉落公告窗+私人信息窗+聊天输入（本地消息流）｜底栏 80px 技能栏 12 格+8 功能按钮（空操作提示）。
- 地图区：背景图 + 绝对定位地点标签（淡黄底 #FFFFE1 蓝边，hover 高亮，当前地点金框）+ 宠物 GIF 标记站当前节点。
- 面板样式：浅蓝渐变 `#cde9f5→#aed7ea`、边 `#58b1d8`、宋体 12px、深蓝 `#14506e`。

## 测试
- unit：maps.json 校验（20 节点、code 唯一、广场存在、locked 出口唯一）。
- db：建角色出生在广场；move 合法 200 / 不存在 404 / locked 400。

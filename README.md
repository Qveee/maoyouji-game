# 《喵游记》开发仓库

单机核心循环 MVP。设计共识见 `docs/开发共识.md`，权威规则见 `docs/游戏规则设计.md`（v2.0）。

## 启动

```powershell
pnpm install
pnpm db:up          # 启动 MySQL 8（首次自动执行 db/migrations）
pnpm dev            # 并行启动 server(3000) 与 web(5173)
```

## 测试

```powershell
pnpm test           # 全部单测（不依赖数据库的部分）
pnpm --filter maoyouji-server test:db   # 连库测试（需先 db:up）
```

## 结构

```
server/   Fastify + TS + mysql2（运行时状态）
web/      Vue 3 + Vite（复刻 2008 页游界面）
db/       顺序 SQL 迁移（MySQL 仅存运行时状态）
docs/     活文档与数值资料
assets/   原版参考素材（42.9MB，授权见 assets/来源与授权.md）
tools/    数值资料导入脚本（切片 8）
```

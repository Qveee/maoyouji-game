import { buildApp } from "./app.ts";
import { config } from "./config.ts";
import { loadPets, loadSkills, validateCrossRefs } from "./data/loader.ts";

// 启动前预载静态数据：zod 校验 + 交叉引用检查，失败抛错拒绝启动（共识 #4）
loadPets(); // 宠物 zod 校验
loadSkills(); // 技能 zod 校验
validateCrossRefs(); // 默认参数即触发 maps+monsters 解析与交叉引用校验

const app = buildApp();

app.listen({ port: config.port, host: "127.0.0.1" }).then((addr) => {
  app.log.info(`server 已启动：${addr}`);
});

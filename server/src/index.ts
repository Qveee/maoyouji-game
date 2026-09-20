import { buildApp } from "./app.js";
import { config } from "./config.js";

const app = buildApp();

app.listen({ port: config.port, host: "127.0.0.1" }).then((addr) => {
  app.log.info(`server 已启动：${addr}`);
});

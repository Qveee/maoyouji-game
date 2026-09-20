import { buildApp } from "./app.ts";
import { config } from "./config.ts";

const app = buildApp();

app.listen({ port: config.port, host: "127.0.0.1" }).then((addr) => {
  app.log.info(`server 已启动：${addr}`);
});

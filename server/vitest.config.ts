import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // db 测试共享同一个 MySQL 库，文件必须串行
    fileParallelism: false,
  },
});

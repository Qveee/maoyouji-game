/** 环境配置：从 .env（若存在）与进程环境读取 */
try {
  process.loadEnvFile();
} catch {
  // 无 .env 文件时忽略，直接用进程环境
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  jwtSecret: process.env.JWT_SECRET ?? "",
};

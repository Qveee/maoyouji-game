/** 环境配置：从 .env（若存在）与进程环境读取 */
try {
  process.loadEnvFile();
} catch {
  // 无 .env 文件时忽略，直接用进程环境
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  // 未显式配置时使用开发默认值（自用单机可接受；生产部署必须设置）
  jwtSecret: process.env.JWT_SECRET ?? "insecure-dev-secret",
  jwtTtlSec: 7 * 24 * 60 * 60,
};

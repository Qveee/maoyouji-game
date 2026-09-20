import { beforeAll, describe, expect, it } from "vitest";
import "../../src/config.ts";
import { getPool } from "../../src/db.ts";

// 仅在配置了 DATABASE_URL 且 MySQL 在跑时执行（pnpm test:db）
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("数据库迁移", () => {
  beforeAll(async () => {
    // 连不上时直接失败，避免误判
    await getPool().query("SELECT 1");
  });

  it("迁移建齐 10 张运行时表", async () => {
    const [rows] = await getPool().query<import("mysql2").RowDataPacket[]>(
      "SHOW TABLES",
    );
    const tables = rows.map((r) => Object.values(r)[0]).sort();
    expect(tables).toEqual([
      "accounts",
      "character_equipment",
      "character_inventory",
      "character_monster_stats",
      "character_quest_progress",
      "character_quests",
      "character_shop_buys",
      "character_skills",
      "characters",
      "chat_messages",
    ]);
  });
});

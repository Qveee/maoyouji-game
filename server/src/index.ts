import { buildApp } from "./app.ts";
import { config } from "./config.ts";
import { loadItems, loadMaps, loadMonsters, loadPets, loadSkills, validateCrossRefs } from "./data/loader.ts";

/** 预载单个静态数据文件，失败时重抛为带文件归属的错误，便于运维直接定位坏数据 */
function preload(label: string, load: () => unknown): void {
  try {
    load();
  } catch (err) {
    throw new Error(`静态数据校验失败：${label} → ${err instanceof Error ? err.message : String(err)}`);
  }
}

// 启动前显式预载全部静态数据：zod 校验 + 交叉引用检查，失败抛错拒绝启动（共识 #4）
preload("server/data/pets.json", loadPets);
preload("server/data/maps.json", loadMaps);
preload("server/data/monsters.json", loadMonsters);
preload("server/data/skills.json", loadSkills);
preload("server/data/items.json", loadItems);
validateCrossRefs(); // spawns 引用的怪物必须存在、怪物 drops 引用的物品必须存在（maps/monsters/items 已就绪）

const app = buildApp();

app.listen({ port: config.port, host: "127.0.0.1" }).then((addr) => {
  app.log.info(`server 已启动：${addr}`);
});

import { readFileSync } from "node:fs";
import { MapsFileSchema, PetsFileSchema, type GameMap, type Pet, type PetsFile } from "./schemas.ts";

const DEFAULT_PATH = new URL("../../data/pets.json", import.meta.url);

/** 读取并校验静态宠物数据；校验失败抛错（共识 #4：拒绝启动） */
export function loadPets(path: URL | string = DEFAULT_PATH): PetsFile {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return PetsFileSchema.parse(raw);
}

let cache: Map<string, Pet> | null = null;

/** code → 宠物 索引（模块级缓存） */
export function petIndex(): Map<string, Pet> {
  if (!cache) {
    cache = new Map(loadPets().pets.map((p) => [p.code, p]));
  }
  return cache;
}

const DEFAULT_MAPS_PATH = new URL("../../data/maps.json", import.meta.url);

/** 读取并校验静态地图数据 */
export function loadMaps(path: URL | string = DEFAULT_MAPS_PATH) {
  return MapsFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

let mapCache: Map<string, GameMap> | null = null;

/** 地图 code → 地图 索引 */
export function mapIndex(): Map<string, GameMap> {
  if (!mapCache) {
    mapCache = new Map(loadMaps().maps.map((m) => [m.code, m]));
  }
  return mapCache;
}

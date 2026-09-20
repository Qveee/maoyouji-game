import { readFileSync } from "node:fs";
import { PetsFileSchema, type Pet, type PetsFile } from "./schemas.ts";

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

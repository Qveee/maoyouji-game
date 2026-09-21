import { readFileSync } from "node:fs";
import {
  MapsFileSchema,
  MonstersFileSchema,
  PetsFileSchema,
  SkillsFileSchema,
  type GameMap,
  type MapNode,
  type Monster,
  type MonstersFile,
  type Pet,
  type PetsFile,
  type Skill,
  type SkillsFile,
} from "./schemas.ts";

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

/** 节点归属：节点 code → 所属地图 code + 节点本体 */
export interface NodeOwner {
  mapCode: string;
  node: MapNode;
}

let nodeCache: Map<string, NodeOwner> | null = null;

/**
 * 节点 code → 归属 索引（模块级缓存）。
 * 节点 code 跨图全局唯一由 MapsFileSchema 交叉引用校验保证，这里直接平铺建索引；
 * adjacent/exit 的引用完整性同样在 schema 层校验，无需在此重复。
 */
export function nodeIndex(): Map<string, NodeOwner> {
  if (!nodeCache) {
    nodeCache = new Map();
    for (const map of mapIndex().values()) {
      for (const node of map.nodes) {
        nodeCache.set(node.code, { mapCode: map.code, node });
      }
    }
  }
  return nodeCache;
}

const DEFAULT_MONSTERS_PATH = new URL("../../data/monsters.json", import.meta.url);

/** 读取并校验静态怪物数据；校验失败抛错（共识 #4：拒绝启动） */
export function loadMonsters(path: URL | string = DEFAULT_MONSTERS_PATH): MonstersFile {
  return MonstersFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

let monsterCache: Map<string, Monster> | null = null;

/** 怪物 code → 怪物 索引（模块级缓存） */
export function monsterIndex(): Map<string, Monster> {
  if (!monsterCache) {
    monsterCache = new Map(loadMonsters().monsters.map((m) => [m.code, m]));
  }
  return monsterCache;
}

const DEFAULT_SKILLS_PATH = new URL("../../data/skills.json", import.meta.url);

/** 读取并校验静态技能数据；校验失败抛错（共识 #4：拒绝启动） */
export function loadSkills(path: URL | string = DEFAULT_SKILLS_PATH): SkillsFile {
  return SkillsFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

let skillCache: Map<string, Skill> | null = null;

/** 技能 code → 技能 索引（模块级缓存） */
export function skillIndex(): Map<string, Skill> {
  if (!skillCache) {
    skillCache = new Map(loadSkills().skills.map((s) => [s.code, s]));
  }
  return skillCache;
}

/**
 * 静态数据交叉引用校验：节点 spawns 引用的怪物必须存在。
 * 放 loader 层而非 schemas，避免 schemas 对 monsters 数据的循环依赖。
 * 在 mapIndex/monsterIndex 都就绪后调用；校验失败抛错（共识 #4：拒绝启动）。
 */
export function validateCrossRefs(
  maps: Map<string, GameMap> = mapIndex(),
  monsters: Map<string, Monster> = monsterIndex(),
): void {
  const checkNode = (mapCode: string, node: MapNode): void => {
    for (const code of node.spawns ?? []) {
      if (!monsters.has(code)) {
        throw new Error(`地图 ${mapCode} 节点 ${node.code} 的 spawns 引用不存在的怪物：${code}`);
      }
    }
  };
  for (const map of maps.values()) {
    for (const node of map.nodes) {
      checkNode(map.code, node);
    }
  }
}

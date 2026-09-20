import { z } from "zod";

/** 五维属性键（顺序即展示顺序） */
export const STAT_KEYS = ["vit", "str", "agi", "intel", "spr"] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

const intStats = z.object({
  vit: z.number().int().min(1).max(20),
  str: z.number().int().min(1).max(20),
  agi: z.number().int().min(1).max(20),
  intel: z.number().int().min(1).max(20),
  spr: z.number().int().min(1).max(20),
});

const floatStats = z.object({
  vit: z.number().min(0).max(2),
  str: z.number().min(0).max(2),
  agi: z.number().min(0).max(2),
  intel: z.number().min(0).max(2),
  spr: z.number().min(0).max(2),
});

export const PetSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(32),
  baseStats: intStats.refine((s) => STAT_KEYS.every((k) => s[k]) && STAT_KEYS.reduce((sum, k) => sum + s[k], 0) === 25, { message: "初始五维总和必须为 25" }),
  growth: floatStats,
  sprite: z.string().min(1),
  description: z.string(),
});

export const PetsFileSchema = z
  .object({ pets: z.array(PetSchema).min(1) })
  .refine((f) => new Set(f.pets.map((p) => p.code)).size === f.pets.length, { message: "宠物 code 重复" });

export type Pet = z.infer<typeof PetSchema>;
export type PetsFile = z.infer<typeof PetsFileSchema>;

/** 地图节点 NPC（切片 3 只展示；chats 留给任务切片） */
const MapNpcSchema = z.object({
  name: z.string().min(1).max(32),
  title: z.string().max(64),
  titleColor: z.string().max(16),
});

export const MapNodeSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(32),
  short: z.string().min(1).max(16),
  x: z.number().int().min(0).max(2000),
  y: z.number().int().min(0).max(2000),
  locked: z.boolean().optional(),
  lockedReason: z.string().optional(),
  npcs: z.array(MapNpcSchema),
});

export const MapSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(32),
  type: z.enum(["town", "field"]),
  background: z.string().min(1),
  spawnNodeCode: z.string().min(1),
  nodes: z.array(MapNodeSchema).min(1),
});

export const MapsFileSchema = z
  .object({ maps: z.array(MapSchema).min(1) })
  .superRefine((file, ctx) => {
    for (const map of file.maps) {
      const codes = new Set<string>();
      for (const node of map.nodes) {
        if (codes.has(node.code)) {
          ctx.addIssue({ code: "custom", message: `地图 ${map.code} 节点 code 重复：${node.code}` });
        }
        codes.add(node.code);
      }
      if (!codes.has(map.spawnNodeCode)) {
        ctx.addIssue({ code: "custom", message: `地图 ${map.code} 出生点 ${map.spawnNodeCode} 不在节点表中` });
      }
    }
  });

export type MapNode = z.infer<typeof MapNodeSchema>;
export type GameMap = z.infer<typeof MapSchema>;
export type MapsFile = z.infer<typeof MapsFileSchema>;

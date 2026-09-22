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

/** 怪物（HP 区间来自原版血量大全；攻防/攻速/经验为 MVP 手写值） */
export const MonsterSchema = z
  .object({
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(32),
    level: z.number().int().min(1).max(200),
    sprite: z.string().min(1),
    hpMin: z.number().int().min(1),
    hpMax: z.number().int().min(1),
    atkMin: z.number().int().min(0),
    atkMax: z.number().int().min(0),
    def: z.number().int().min(0),
    dodgeRate: z.number().min(0).lt(1),
    critRate: z.number().min(0).lt(1),
    intervalMs: z.number().int().min(500).max(10000),
    exp: z.number().int().min(0),
    /** 图鉴展示字段（照原型 MONSTERS 字典考据）：定位类型与描述，可选；缺省时前端走兜底文案 */
    type: z.string().max(32).optional(),
    desc: z.string().max(200).optional(),
  })
  .refine((m) => m.hpMin <= m.hpMax, { message: "hpMin 不能大于 hpMax" })
  .refine((m) => m.atkMin <= m.atkMax, { message: "atkMin 不能大于 atkMax" });

export const MonstersFileSchema = z
  .object({ monsters: z.array(MonsterSchema).min(1) })
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    for (const m of f.monsters) {
      if (seen.has(m.code)) {
        ctx.addIssue({ code: "custom", message: `怪物 code 重复：${m.code}` });
      }
      seen.add(m.code);
    }
  });

export type Monster = z.infer<typeof MonsterSchema>;
export type MonstersFile = z.infer<typeof MonstersFileSchema>;

/** 技能公共字段 */
const skillBase = {
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(32),
  profession: z.enum(["warrior", "mage"]),
  preset: z.boolean(),
  spCost: z.number().int().min(0),
  cdMs: z.number().int().min(0),
  castMs: z.number().int().min(0),
  description: z.string(),
};

/**
 * 技能按 kind 判别：近战加伤只带 bonusDamage，直接伤害只带 dmgMin/dmgMax。
 * strictObject 让互斥成为硬约束（带错 kind 的字段直接拒绝）。
 */
export const SkillSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...skillBase, kind: z.literal("next_hit_bonus"), bonusDamage: z.number().int().min(0) }),
  z.strictObject({
    ...skillBase,
    kind: z.literal("direct_damage"),
    dmgMin: z.number().int().min(0),
    dmgMax: z.number().int().min(0),
  }),
]);

export const SkillsFileSchema = z
  .object({ skills: z.array(SkillSchema).min(1) })
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    for (const s of f.skills) {
      if (seen.has(s.code)) {
        ctx.addIssue({ code: "custom", message: `技能 code 重复：${s.code}` });
      }
      seen.add(s.code);
      if (s.kind === "direct_damage" && s.dmgMin > s.dmgMax) {
        ctx.addIssue({ code: "custom", message: `技能 ${s.code} 的 dmgMin 不能大于 dmgMax` });
      }
    }
  });

export type Skill = z.infer<typeof SkillSchema>;
export type SkillsFile = z.infer<typeof SkillsFileSchema>;

/** 地图节点 NPC（切片 3 只展示；chats 留给任务切片） */
const MapNpcSchema = z.object({
  name: z.string().min(1).max(32),
  title: z.string().max(64),
  titleColor: z.string().max(16),
});

/** 跨图出口：目标地图 code + 目标节点 code */
const MapExitSchema = z.object({
  map: z.string().min(1).max(64),
  node: z.string().min(1).max(64),
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
  /** 相邻节点（field 地图走格子用），引用全局节点 code */
  adjacent: z.array(z.string().min(1).max(64)).optional(),
  /** 跨地图出口 */
  exit: MapExitSchema.optional(),
  /** 刷怪分区：可出现的怪物 code 列表（对怪物数据的交叉引用在 loader 层校验，避免循环依赖） */
  spawns: z.array(z.string().min(1).max(64)).optional(),
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
    // 节点 code 跨地图全局唯一（自然覆盖单地图内去重）
    const owner = new Map<string, string>(); // 节点 code → 所属地图 code
    for (const map of file.maps) {
      for (const node of map.nodes) {
        const prev = owner.get(node.code);
        if (prev) {
          ctx.addIssue({ code: "custom", message: `节点 code 跨地图重复：${node.code}（${prev} 与 ${map.code}）` });
        } else {
          owner.set(node.code, map.code);
        }
      }
    }
    const mapByCode = new Map(file.maps.map((m) => [m.code, m]));
    for (const map of file.maps) {
      const nodeCodes = new Set(map.nodes.map((n) => n.code));
      if (!nodeCodes.has(map.spawnNodeCode)) {
        ctx.addIssue({ code: "custom", message: `地图 ${map.code} 出生点 ${map.spawnNodeCode} 不在节点表中` });
      }
      for (const node of map.nodes) {
        for (const adj of node.adjacent ?? []) {
          const adjOwner = owner.get(adj);
          if (!adjOwner) {
            ctx.addIssue({
              code: "custom",
              message: `地图 ${map.code} 节点 ${node.code} 的 adjacent 引用不存在的节点：${adj}`,
            });
          } else if (adjOwner !== map.code) {
            // 走格子只在图内相邻格间进行，跨图必须走 exit
            ctx.addIssue({
              code: "custom",
              message: `地图 ${map.code} 节点 ${node.code} 的相邻格引用了其他地图（${adjOwner}）的节点：${adj}`,
            });
          }
        }
        const exit = node.exit;
        if (exit) {
          const target = mapByCode.get(exit.map);
          if (!target) {
            ctx.addIssue({ code: "custom", message: `节点 ${node.code} 的 exit 引用不存在的地图：${exit.map}` });
          } else if (!target.nodes.some((n) => n.code === exit.node)) {
            ctx.addIssue({
              code: "custom",
              message: `节点 ${node.code} 的 exit 引用地图 ${exit.map} 中不存在的节点：${exit.node}`,
            });
          }
        }
      }
    }
  });

export type MapNode = z.infer<typeof MapNodeSchema>;
export type GameMap = z.infer<typeof MapSchema>;
export type MapsFile = z.infer<typeof MapsFileSchema>;

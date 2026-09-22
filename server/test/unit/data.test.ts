import { describe, expect, it } from "vitest";
import {
  loadItems,
  loadMaps,
  loadMonsters,
  loadPets,
  loadSkills,
  itemIndex,
  mapIndex,
  monsterIndex,
  validateCrossRefs,
} from "../../src/data/loader.ts";
import {
  ItemsFileSchema,
  MapsFileSchema,
  MonstersFileSchema,
  PetsFileSchema,
  SkillsFileSchema,
} from "../../src/data/schemas.ts";

describe("静态宠物数据", () => {
  it("内置 pets.json 含 17 种宠物且全部可选", () => {
    const file = loadPets();
    expect(file.pets).toHaveLength(17);
  });

  it("code 重复被拒绝", () => {
    const file = loadPets();
    const dup = { pets: [file.pets[0]!, { ...file.pets[1]!, code: file.pets[0]!.code }] };
    expect(() => PetsFileSchema.parse(dup)).toThrow(/重复/);
  });

  it("初始五维总和不为 25 被拒绝", () => {
    const file = loadPets();
    const bad = { pets: [{ ...file.pets[0]!, baseStats: { vit: 9, str: 9, agi: 5, intel: 5, spr: 5 } }] };
    expect(() => PetsFileSchema.parse(bad)).toThrow(/25/);
  });

  it("猫隐村地图含 20 节点且牧野草原入口已解锁", () => {
    const village = loadMaps().maps.find((m) => m.code === "maoyin_village")!;
    expect(village.nodes).toHaveLength(20);
    expect(new Set(village.nodes.map((n) => n.code)).size).toBe(20);
    expect(village.spawnNodeCode).toBe("guangchang");
    // muye03 已解锁，锁点清零
    expect(village.nodes.filter((n) => n.locked)).toHaveLength(0);
    const muye03 = village.nodes.find((n) => n.code === "muye03")!;
    expect(muye03.exit).toEqual({ map: "muye_caoyuan", node: "my03" });
    expect(village.nodes.reduce((s, n) => s + n.npcs.length, 0)).toBeGreaterThan(80);
  });
});

describe("静态怪物数据", () => {
  it("内置 monsters.json 含 5 种牧野草原怪物且通过 zod 校验", () => {
    const file = loadMonsters();
    expect(file.monsters).toHaveLength(5);
    expect(file.monsters.map((m) => m.code)).toEqual(["paopao", "lvmaochong", "xiaoji", "hongmogu", "caoyuanxie"]);
  });

  it("泡泡考据数值：原版血量大全 1~3 级 HP20~40 动物中型（MVP 取 1 级入门）", () => {
    const paopao = loadMonsters().monsters.find((m) => m.code === "paopao")!;
    expect(paopao.name).toBe("泡泡");
    expect(paopao.level).toBe(1);
    expect(paopao.sprite).toBe("/monsters/BoLi.gif");
    expect(paopao.hpMin).toBe(20);
    expect(paopao.hpMax).toBe(40);
    expect(paopao.exp).toBe(40); // 与同级绿毛虫对齐
  });

  it("code 重复被拒绝", () => {
    const file = loadMonsters();
    const dup = { monsters: [file.monsters[0]!, { ...file.monsters[1]!, code: file.monsters[0]!.code }] };
    expect(() => MonstersFileSchema.parse(dup)).toThrow(/重复/);
  });

  it("hpMin 大于 hpMax 被拒绝", () => {
    const file = loadMonsters();
    const bad = { monsters: [{ ...file.monsters[0]!, hpMin: 50, hpMax: 40 }] };
    expect(() => MonstersFileSchema.parse(bad)).toThrow(/hpMin/);
  });

  it("闪避/暴击率必须在 [0,1) 区间", () => {
    const file = loadMonsters();
    expect(() => MonstersFileSchema.parse({ monsters: [{ ...file.monsters[0]!, dodgeRate: 1 }] })).toThrow();
    expect(() => MonstersFileSchema.parse({ monsters: [{ ...file.monsters[0]!, critRate: -0.1 }] })).toThrow();
  });

  it("图鉴字段 type/desc 可选且随静态数据透传", () => {
    const file = loadMonsters();
    // 绿毛虫照原型填了考据文本，红蘑菇原版无收录不加字段（走前端兜底文案）
    const worm = file.monsters.find((m) => m.code === "lvmaochong")!;
    expect(worm.type).toBe("战士 昆虫辅助");
    expect(worm.desc).toBe("牧野草原最常见的小虫，圆滚滚的身子行动迟缓，靠啃食嫩草为生，最适合新手练手。");
    const mogu = file.monsters.find((m) => m.code === "hongmogu")!;
    expect(mogu.type).toBeUndefined();
    expect(mogu.desc).toBeUndefined();
    // 缺省字段合法（不破坏既有校验），zod infer 透传到 Monster 类型
    expect(() => MonstersFileSchema.parse({ monsters: [mogu] })).not.toThrow();
  });
});

describe("静态技能数据", () => {
  it("内置 skills.json 含战士/法师各 1 个预设技能", () => {
    const file = loadSkills();
    expect(file.skills).toHaveLength(2);
    const qiangli = file.skills.find((s) => s.code === "qiangli_daji")!;
    expect(qiangli.profession).toBe("warrior");
    expect(qiangli.preset).toBe(true);
    const huoqiu = file.skills.find((s) => s.code === "huoqiu_shu")!;
    expect(huoqiu.profession).toBe("mage");
    expect(huoqiu.preset).toBe(true);
  });

  it("kind 与伤害字段互斥：带错字段或缺字段均被拒绝", () => {
    const file = loadSkills();
    const nextHit = file.skills.find((s) => s.code === "qiangli_daji")!;
    const direct = file.skills.find((s) => s.code === "huoqiu_shu")!;
    // next_hit_bonus 不允许出现 dmgMin/dmgMax
    expect(SkillsFileSchema.safeParse({ skills: [{ ...nextHit, dmgMin: 5, dmgMax: 9 }] }).success).toBe(false);
    // direct_damage 不允许出现 bonusDamage
    expect(SkillsFileSchema.safeParse({ skills: [{ ...direct, bonusDamage: 5 }] }).success).toBe(false);
    // direct_damage 缺 dmgMin/dmgMax 被拒绝
    const missingDamage = {
      code: "huoqiu_shu",
      name: "火球术",
      profession: "mage",
      preset: true,
      kind: "direct_damage",
      spCost: 20,
      cdMs: 0,
      castMs: 5000,
      description: "缺伤害字段",
    };
    expect(SkillsFileSchema.safeParse({ skills: [missingDamage] }).success).toBe(false);
  });

  it("direct_damage 的 dmgMin 不得大于 dmgMax", () => {
    const file = loadSkills();
    const direct = file.skills.find((s) => s.code === "huoqiu_shu")!;
    expect(() => SkillsFileSchema.parse({ skills: [{ ...direct, dmgMin: 30, dmgMax: 20 }] })).toThrow(/dmgMin/);
  });
});

describe("地图交叉引用校验", () => {
  it("节点 code 跨地图重复被拒绝", () => {
    const file = loadMaps();
    const village = file.maps.find((m) => m.code === "maoyin_village")!;
    const muye = file.maps.find((m) => m.code === "muye_caoyuan")!;
    const dup = { ...muye, nodes: [...muye.nodes, { ...muye.nodes[0]!, code: village.nodes[0]!.code }] };
    expect(() => MapsFileSchema.parse({ maps: [village, dup] })).toThrow(/跨地图重复/);
  });

  it("adjacent 引用不存在的节点被拒绝", () => {
    const file = loadMaps();
    const village = file.maps.find((m) => m.code === "maoyin_village")!;
    const bad = {
      ...village,
      nodes: village.nodes.map((n, i) => (i === 0 ? { ...n, adjacent: ["不存在的节点"] } : n)),
    };
    expect(() => MapsFileSchema.parse({ maps: [bad] })).toThrow(/adjacent 引用不存在的节点/);
  });

  it("adjacent 引用其他地图的已有节点被拒绝（相邻格必须同图）", () => {
    const file = loadMaps();
    const village = file.maps.find((m) => m.code === "maoyin_village")!;
    const muye = file.maps.find((m) => m.code === "muye_caoyuan")!;
    // my03 全局存在但归属牧野草原，村节点不能拿它当相邻格（跨图走 exit）
    const bad = {
      ...village,
      nodes: village.nodes.map((n) => (n.code === "muye03" ? { ...n, adjacent: ["my03"] } : n)),
    };
    expect(() => MapsFileSchema.parse({ maps: [bad, muye] })).toThrow(/相邻格引用了其他地图/);
  });

  it("exit 引用不存在的地图被拒绝", () => {
    const file = loadMaps();
    const village = file.maps.find((m) => m.code === "maoyin_village")!;
    const bad = {
      ...village,
      nodes: village.nodes.map((n) =>
        n.code === "muye03" ? { ...n, exit: { map: "no_such_map", node: "my_rukou" } } : n,
      ),
    };
    expect(() => MapsFileSchema.parse({ maps: [bad] })).toThrow(/exit 引用不存在的地图/);
  });

  it("exit 引用目标地图不存在的节点被拒绝", () => {
    const file = loadMaps();
    const village = file.maps.find((m) => m.code === "maoyin_village")!;
    const muye = file.maps.find((m) => m.code === "muye_caoyuan")!;
    const bad = {
      ...village,
      nodes: village.nodes.map((n) =>
        n.code === "muye03" ? { ...n, exit: { map: "muye_caoyuan", node: "不存在的节点" } } : n,
      ),
    };
    expect(() => MapsFileSchema.parse({ maps: [bad, muye] })).toThrow(/不存在的节点/);
  });
});

describe("牧野草原地图", () => {
  it("含 38 节点：出生点村口、边界锁点合法、与猫隐村互为出口", () => {
    const muye = loadMaps().maps.find((m) => m.code === "muye_caoyuan")!;
    expect(muye.type).toBe("field");
    expect(muye.background).toBe("/maps/muyecaoyuan.jpg");
    expect(muye.spawnNodeCode).toBe("my_rukou");
    expect(muye.nodes).toHaveLength(38);
    const rukou = muye.nodes.find((n) => n.code === "my_rukou")!;
    expect(rukou.exit).toEqual({ map: "maoyin_village", node: "cunkou" });
    expect(rukou.locked).toBeUndefined();
    for (const code of ["my_wanma", "my_aolin"]) {
      expect(muye.nodes.find((n) => n.code === code)!.locked).toBe(true);
    }
    // 野外节点无静态 NPC（怪物是运行时实例）
    expect(muye.nodes.every((n) => n.npcs.length === 0)).toBe(true);
  });

  it("从 my_rukou 出发 BFS 沿 adjacent 全部 38 节点可达", () => {
    const muye = mapIndex().get("muye_caoyuan")!;
    const byCode = new Map(muye.nodes.map((n) => [n.code, n]));
    const seen = new Set<string>([muye.spawnNodeCode]);
    const queue = [muye.spawnNodeCode];
    while (queue.length > 0) {
      const cur = byCode.get(queue.shift()!)!;
      for (const adj of cur.adjacent ?? []) {
        if (byCode.has(adj) && !seen.has(adj)) {
          seen.add(adj);
          queue.push(adj);
        }
      }
    }
    expect(seen.size).toBe(38);
    for (const n of muye.nodes) {
      expect(seen.has(n.code)).toBe(true);
    }
  });

  it("邻接表对称：每条图内边 a→b 必有反向边 b→a", () => {
    const muye = mapIndex().get("muye_caoyuan")!;
    const byCode = new Map(muye.nodes.map((n) => [n.code, n]));
    for (const n of muye.nodes) {
      for (const adj of n.adjacent ?? []) {
        const other = byCode.get(adj);
        // 悬空引用与跨图 adjacent 均由 schema 交叉引用校验拦截，这里只查图内对称性
        if (!other) continue;
        expect(other.adjacent ?? [], `边 ${n.code}→${adj} 缺少反向边 ${adj}→${n.code}`).toContain(n.code);
      }
    }
  });

  it("刷怪分区覆盖 35 个节点且只引用已定义的怪物", () => {
    const muye = mapIndex().get("muye_caoyuan")!;
    const monsters = monsterIndex();
    const spawned = muye.nodes.filter((n) => (n.spawns?.length ?? 0) > 0);
    expect(spawned).toHaveLength(35);
    for (const n of spawned) {
      for (const code of n.spawns!) {
        expect(monsters.has(code)).toBe(true);
      }
    }
    // 入口与边界锁点无怪
    for (const code of ["my_rukou", "my_wanma", "my_aolin"]) {
      expect(muye.nodes.find((n) => n.code === code)!.spawns).toBeUndefined();
    }
  });

  it("泡泡与绿毛虫同区：原版 1~3 级新手区 10 节点刷怪池均含 paopao", () => {
    const muye = mapIndex().get("muye_caoyuan")!;
    const withPaopao = muye.nodes.filter((n) => n.spawns?.includes("paopao"));
    expect(withPaopao.map((n) => n.code)).toEqual([
      "my00", "my01", "my02", "my03", "my07", "my10", "my11", "my12", "my13", "my14",
    ]);
  });
});

describe("刷怪分区交叉引用（loader 层）", () => {
  it("内置数据 spawns 引用的怪物全部存在", () => {
    expect(() => validateCrossRefs()).not.toThrow();
  });

  it("spawns 引用不存在的怪物时抛错", () => {
    const monsters = new Map(monsterIndex());
    monsters.delete("caoyuanxie");
    expect(() => validateCrossRefs(mapIndex(), monsters)).toThrow(/不存在的怪物/);
  });
});

describe("items.json 静态物品", () => {
  it("通过 zod 校验且 code 唯一", () => {
    const f = loadItems();
    expect(f.items.length).toBeGreaterThanOrEqual(20);
    expect(ItemsFileSchema.safeParse(f).success).toBe(true);
  });
  it("装备 kind 判别：武器必带伤害区间与攻速，防具无伤害字段", () => {
    const items = itemIndex();
    const w = items.get("bubingjian")!;
    expect(w.kind).toBe("equipment");
    if (w.kind === "equipment") {
      expect(w.dmgMin).toBe(7);
      expect(w.dmgMax).toBe(9);
      expect(w.intervalMs).toBe(2100);
      expect(w.quality).toBe("green");
    }
    const a = items.get("yama_waiyi")!;
    if (a.kind === "equipment") expect(a.dmgMin).toBeUndefined();
  });
  it("消耗品 effect 至少一项", () => {
    const y = itemIndex().get("xiaoxing_buxueji")!;
    expect(y.kind).toBe("consumable");
    if (y.kind === "consumable") expect(y.effect.hp).toBe(50);
  });
  it("考据抽查：步兵剑 7-9/速度2.1/耐久13/等级4；能量之卷刃剑带攻击+2；冰风靴体力+2智力+2", () => {
    const idx = itemIndex();
    const b = idx.get("bubingjian")!;
    if (b.kind === "equipment") {
      expect([b.dmgMin, b.dmgMax, b.intervalMs, b.durabilityMax, b.levelReq]).toEqual([7, 9, 2100, 13, 4]);
      expect(b.profession).toBe("warrior");
    }
    const e = idx.get("nengliang_juanrenjian")!;
    if (e.kind === "equipment") expect(e.bonuses.atk).toBe(2);
    const i = idx.get("bingfeng_xue")!;
    if (i.kind === "equipment") expect(i.bonuses).toMatchObject({ vit: 2, intel: 2 });
  });
  it("非法装备（武器缺伤害区间）被拒绝", () => {
    const bad = { items: [{ code: "x", name: "断剑", sprite: "/i.png", desc: "", kind: "equipment",
      quality: "gray", slot: "main_hand", equipType: "剑", profession: "warrior",
      levelReq: 1, durabilityMax: 10, hands: 1 }] };
    expect(ItemsFileSchema.safeParse(bad).success).toBe(false);
  });
  it("怪物 drops 引用不存在的物品时 validateCrossRefs 抛错", () => {
    const monsters = MonstersFileSchema.parse({ monsters: [
      { code: "m1", name: "怪", level: 1, sprite: "/m.gif", hpMin: 1, hpMax: 2, atkMin: 0, atkMax: 1,
        def: 0, dodgeRate: 0, critRate: 0, intervalMs: 1000, exp: 1,
        drops: { copper: [1, 2], items: [{ item: "no_such_item", chance: 0.5 }] } },
    ]});
    expect(() => validateCrossRefs(new Map(), new Map(monsters.monsters.map((m) => [m.code, m])))).toThrow(/no_such_item/);
  });
  it("现有 monsters.json 每只怪都配了 drops", () => {
    for (const m of loadMonsters().monsters) expect(m.drops, m.code).toBeDefined();
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { buildApp } from "../../src/app.ts";
import { getPool } from "../../src/db.ts";
import { EQUIP_SLOT_CODES } from "../../src/game/inventory.ts";
import { hpMaxOf, spMaxOf } from "../../src/game/rules.ts";
import { resetDb, registerAndLogin, cookieOf } from "./helpers.ts";

const app = buildApp();
/** 战士「背包猫」：主视角角色 */
let cookie = "";
let charId = 0;
/** 法师「借装猫」：跨角色 404 用例用（无需选中，仅作背包行归属者） */
let otherCharId = 0;

beforeAll(async () => {
  await resetDb();
  const acc = await registerAndLogin(app, "bagcat");
  const created = await app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie: acc },
    payload: { name: "背包猫", breedCode: "mao", profession: "warrior" },
  });
  charId = created.json().id;
  const sel = await app.inject({
    method: "POST",
    url: "/api/auth/select-character",
    headers: { cookie: acc },
    payload: { characterId: charId },
  });
  cookie = cookieOf(sel);

  const acc2 = await registerAndLogin(app, "othercat");
  const created2 = await app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie: acc2 },
    payload: { name: "借装猫", breedCode: "mao", profession: "mage" },
  });
  otherCharId = created2.json().id;
});

afterAll(async () => {
  await app.close();
});

// ---------- 请求助手 ----------

function get(who = cookie) {
  return app.inject({ method: "GET", url: "/api/inventory", headers: { cookie: who } });
}
function equipReq(inventoryId: number, who = cookie) {
  return app.inject({ method: "POST", url: "/api/inventory/equip", headers: { cookie: who }, payload: { inventoryId } });
}
function unequipReq(slotCode: string, who = cookie) {
  return app.inject({ method: "POST", url: "/api/inventory/unequip", headers: { cookie: who }, payload: { slotCode } });
}
function useReq(inventoryId: number, who = cookie) {
  return app.inject({ method: "POST", url: "/api/inventory/use", headers: { cookie: who }, payload: { inventoryId } });
}
function discardReq(inventoryId: number, quantity?: number, who = cookie) {
  return app.inject({
    method: "POST",
    url: "/api/inventory/discard",
    headers: { cookie: who },
    payload: quantity === undefined ? { inventoryId } : { inventoryId, quantity },
  });
}

// ---------- 库内助手 ----------

/** 直插一行背包行（装备带耐久，消耗品/材料 durability NULL），返回行 id */
async function insertRow(
  itemCode: string,
  slotIndex: number | null,
  quantity = 1,
  durability: number | null = null,
  ownerCharId = charId,
): Promise<number> {
  const [r] = await getPool().query<ResultSetHeader>(
    `INSERT INTO character_inventory (character_id, item_code, slot_index, quantity, durability)
     VALUES (?, ?, ?, ?, ?)`,
    [ownerCharId, itemCode, slotIndex, quantity, durability],
  );
  return Number(r.insertId);
}

/** 直绑穿戴位（配合 slot_index=NULL 的背包行，模拟已穿戴状态） */
async function bindEquip(slotCode: string, inventoryId: number, ownerCharId = charId): Promise<void> {
  await getPool().query(
    "INSERT INTO character_equipment (character_id, slot_code, inventory_id) VALUES (?, ?, ?)",
    [ownerCharId, slotCode, inventoryId],
  );
}

/** 清空角色背包 + 装备位（先删装备位再删背包行，外键顺序） */
async function freshBag(ownerCharId = charId): Promise<void> {
  await getPool().query("DELETE FROM character_equipment WHERE character_id = ?", [ownerCharId]);
  await getPool().query("DELETE FROM character_inventory WHERE character_id = ?", [ownerCharId]);
}

/** 批量填充 [from, from+count) 连续格位的材料堆（满包夹具用） */
async function fillBag(itemCode: string, from: number, count: number, ownerCharId = charId): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];
  for (let s = from; s < from + count; s++) {
    placeholders.push("(?, ?, ?, 1, NULL)");
    values.push(ownerCharId, itemCode, s);
  }
  await getPool().query(
    `INSERT INTO character_inventory (character_id, item_code, slot_index, quantity, durability)
     VALUES ${placeholders.join(", ")}`,
    values,
  );
}

interface InvRow extends RowDataPacket {
  id: number;
  item_code: string;
  slot_index: number | null;
  quantity: number;
  durability: number | null;
}

async function invRowsOf(ownerCharId = charId): Promise<InvRow[]> {
  const [rows] = await getPool().query<InvRow[]>(
    `SELECT id, item_code, slot_index, quantity, durability FROM character_inventory
     WHERE character_id = ? ORDER BY id`,
    [ownerCharId],
  );
  return rows;
}

interface EqRow extends RowDataPacket {
  slot_code: string;
  inventory_id: number;
}

async function eqRowsOf(ownerCharId = charId): Promise<EqRow[]> {
  const [rows] = await getPool().query<EqRow[]>(
    "SELECT slot_code, inventory_id FROM character_equipment WHERE character_id = ? ORDER BY slot_code",
    [ownerCharId],
  );
  return rows;
}

// ---------- GET 背包视图 ----------

describe("GET /api/inventory", () => {
  it("空背包：300 格口径空数组 + copper 0 + 14 栏位全 null 的 equipment + 零加成", async () => {
    await freshBag();
    const res = await get();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.copper).toBe(0);
    expect(body.bag).toEqual([]);
    expect(Object.keys(body.equipment).sort()).toEqual([...EQUIP_SLOT_CODES].sort());
    for (const code of EQUIP_SLOT_CODES) expect(body.equipment[code]).toBeNull();
    expect(body.bonuses).toEqual({
      vit: 0, str: 0, agi: 0, intel: 0, spr: 0, hp: 0, sp: 0, atk: 0, def: 0,
      dmgMin: null, dmgMax: null, intervalMs: null,
    });
  });

  it("背包行带静态 join 字段（按 slotIndex 升序）；装备行带 equip 子对象", async () => {
    await freshBag();
    const mat = await insertRow("kunchong_waike", 5, 3);
    const sword = await insertRow("nongfuzhijian", 1, 1, 10);
    const res = await get();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.bag).toHaveLength(2);
    // 升序：slot 1（剑）在前、slot 5（材料）在后
    expect(body.bag[0]).toMatchObject({
      inventoryId: sword, itemCode: "nongfuzhijian", slotIndex: 1, quantity: 1, durability: 10,
      name: "农夫之剑", quality: "gray", kind: "equipment", stackMax: 1,
    });
    expect(body.bag[0].equip).toMatchObject({
      slot: "main_hand", equipType: "剑", hands: 1, levelReq: 1,
      dmgMin: 2, dmgMax: 4, intervalMs: 2600, bonuses: {},
    });
    expect(body.bag[1]).toMatchObject({
      inventoryId: mat, itemCode: "kunchong_waike", slotIndex: 5, quantity: 3, durability: null,
      name: "昆虫外壳", quality: "", kind: "material", stackMax: 99,
    });
    expect(body.bag[1].equip).toBeUndefined(); // 非装备无 equip 子对象
    await freshBag();
  });
});

// ---------- equip 穿戴 ----------

describe("POST /api/inventory/equip", () => {
  it("等级不足 400（message 含「等级」）；职业不符（战士穿魔杖）400；非装备 400", async () => {
    await freshBag();
    const lowLevel = await insertRow("bubingjian", 0, 1, 13); // 步兵剑 levelReq 4 > 当前 1 级
    const res = await equipReq(lowLevel);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("等级");

    const wrongProf = await insertRow("xiangmuzhang", 1, 1, 10); // 橡木杖限法师
    const res2 = await equipReq(wrongProf);
    expect(res2.statusCode).toBe(400);

    const material = await insertRow("kunchong_waike", 2, 1);
    const res3 = await equipReq(material);
    expect(res3.statusCode).toBe(400);
  });

  it("空部位成功：inventory 行 slot_index=NULL，equipment 表出现 targetSlot", async () => {
    await freshBag();
    const sword = await insertRow("nongfuzhijian", 3, 1, 10);
    const res = await equipReq(sword);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const rows = await invRowsOf();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.slot_index).toBeNull(); // 离包
    expect((await eqRowsOf())).toEqual([{ slot_code: "main_hand", inventory_id: sword }]);
  });

  it("部位占用直接替换：旧装备回背包空格（slot 0）、新装备上位", async () => {
    await freshBag();
    // 农夫之剑(1级)/步兵剑(4级)同为主手：抬到 5 级让两把都可穿（后续用例沿用该等级）
    await getPool().query("UPDATE characters SET level = 5 WHERE id = ?", [charId]);
    const swordA = await insertRow("nongfuzhijian", 0, 1, 10);
    const swordB = await insertRow("bubingjian", 1, 1, 13);
    expect((await equipReq(swordA)).statusCode).toBe(200);

    const res = await equipReq(swordB);
    expect(res.statusCode).toBe(200);
    // 旧件 A 回包（唯一空闲格 0——B 的原格 1 也被①腾出，但 firstFreeSlot 取最小）
    const rows = await invRowsOf();
    const rowA = rows.find((r) => r.id === swordA)!;
    const rowB = rows.find((r) => r.id === swordB)!;
    expect(Number(rowA.slot_index)).toBe(0);
    expect(rowB.slot_index).toBeNull();
    expect((await eqRowsOf())).toEqual([{ slot_code: "main_hand", inventory_id: swordB }]);
  });

  it("替换后 equipment 表行校验：被替换件行 DELETE、新装备行 UPSERT 到 targetSlot", async () => {
    // 承接上一用例终态（main_hand=B，A@0），再穿第三件验证 ③④ 落库顺序
    const swordC = await insertRow("liliang_juanrenjian", 1, 1, 17); // 力量之卷刃剑 levelReq 5
    const before = await eqRowsOf();
    expect(before).toEqual([{ slot_code: "main_hand", inventory_id: expect.any(Number) }]);
    const swordBId = Number(before[0]!.inventory_id);

    const res = await equipReq(swordC);
    expect(res.statusCode).toBe(200);
    // 全表只有一行：main_hand → C（B 的行随 UPSERT 原地改指 + DELETE 兜底，绝不残留双行）
    const after = await eqRowsOf();
    expect(after).toEqual([{ slot_code: "main_hand", inventory_id: swordC }]);
    // 被替换件 B 回包 slot 1（其被 A 腾换后的原位语义由 firstFreeSlot 重算：A@0 占用 → 1）
    const rows = await invRowsOf();
    const rowB = rows.find((r) => r.id === swordBId)!;
    expect(Number(rowB.slot_index)).toBe(1);
  });

  it("满包替换成功：300 格全占时替换主手，旧装备进新装备腾出的原格（净 0）", async () => {
    await freshBag();
    // 已穿戴主手（slot NULL 直绑）+ 背包 300 格全占：299 格材料 + 新主手剑占格 299
    const wornSword = await insertRow("nongfuzhijian", null, 1, 10);
    await bindEquip("main_hand", wornSword);
    await fillBag("kunchong_waike", 0, 299);
    const newSword = await insertRow("nongfuzhijian", 299, 1, 10);
    // 300 格全占（已穿戴行 slot NULL 不占格）：299 材料 + 新主手剑
    expect((await invRowsOf()).filter((r) => r.slot_index != null)).toHaveLength(300);

    const res = await equipReq(newSword);
    expect(res.statusCode).toBe(200); // 新件离包腾出自己的格 → 单件替换净 0 可行
    const rows = await invRowsOf();
    const rowWorn = rows.find((r) => r.id === wornSword)!;
    const rowNew = rows.find((r) => r.id === newSword)!;
    expect(Number(rowWorn.slot_index)).toBe(299); // 旧装备进新装备腾出的格
    expect(rowNew.slot_index).toBeNull();
    expect((await eqRowsOf())).toEqual([{ slot_code: "main_hand", inventory_id: newSword }]);
    await freshBag();
  });

  it("inventoryId 不存在 / 不是当前角色的 → 404", async () => {
    await freshBag();
    const ghost = await equipReq(999999);
    expect(ghost.statusCode).toBe(404);

    const others = await insertRow("nongfuzhijian", 0, 1, 10, otherCharId); // 法师的剑
    const res = await equipReq(others);
    expect(res.statusCode).toBe(404);
    await freshBag(otherCharId);
  });
});

// ---------- unequip 卸下 ----------

describe("POST /api/inventory/unequip", () => {
  it("成功回包（slot_index=firstFreeSlot）；包满 400（脱下净 +1 格无空位可回）", async () => {
    await freshBag();
    const sword = await insertRow("nongfuzhijian", 2, 1, 10);
    expect((await equipReq(sword)).statusCode).toBe(200);

    const res = await unequipReq("main_hand");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const rows = await invRowsOf();
    expect(Number(rows.find((r) => r.id === sword)!.slot_index)).toBe(0); // 包空 → 首格 0
    expect(await eqRowsOf()).toEqual([]);

    // 包满：脱下净 +1 格 → 400，拒绝即无改动（包内已有卸下的剑占格 0，再填 299 格凑满 300）
    const wornSword = await insertRow("nongfuzhijian", null, 1, 10);
    await bindEquip("main_hand", wornSword);
    await fillBag("kunchong_waike", 1, 299);
    const full = await unequipReq("main_hand");
    expect(full.statusCode).toBe(400);
    expect(full.json().message).toBe("背包已满");
    expect((await eqRowsOf())).toEqual([{ slot_code: "main_hand", inventory_id: wornSword }]);
    expect((await invRowsOf()).filter((r) => r.slot_index != null)).toHaveLength(300);
    await freshBag();
  });
});

// ---------- use 用药 ----------

describe("POST /api/inventory/use", () => {
  it("小型补血剂：quantity -1（归零删行）、hp 回复不溢基础上限、锚点推进；非消耗品 400", async () => {
    await freshBag();
    const [chars] = await getPool().query<RowDataPacket[]>(
      "SELECT level, vit, intel FROM characters WHERE id = ?",
      [charId],
    );
    const maxHp = hpMaxOf(Number(chars[0]!.level), Number(chars[0]!.vit));
    const maxSp = spMaxOf(Number(chars[0]!.level), Number(chars[0]!.intel));
    // 夹具：hp 压到 max-10、恢复锚点拨回 1 小时前（补算后仍 ≥ max-10，回复必顶满不溢出）
    await getPool().query(
      "UPDATE characters SET hp = ?, resources_updated_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?",
      [maxHp - 10, charId],
    );
    const potion = await insertRow("xiaoxing_buxueji", 0, 1); // qty 1：用完即删行

    const res = await useReq(potion);
    expect(res.statusCode).toBe(200);
    expect(res.json().hp).toBe(maxHp); // MIN(基础上限, 当前+50) 不溢出
    expect((await invRowsOf()).find((r) => r.id === potion)).toBeUndefined(); // 归零删行

    const [after] = await getPool().query<RowDataPacket[]>(
      "SELECT hp, resources_updated_at FROM characters WHERE id = ?",
      [charId],
    );
    expect(Number(after[0]!.hp)).toBe(maxHp);
    expect(new Date(after[0]!.resources_updated_at as unknown as string).getTime())
      .toBeGreaterThan(Date.now() - 60_000); // 锚点已推进到当下

    // 减量路径：quantity > 1 用后 -1 不删行（sp 同按基础上限 clamp）
    const spPotion = await insertRow("xiao_mofaji", 0, 3); // 小魔法剂 effect.sp=30
    const res2 = await useReq(spPotion);
    expect(res2.statusCode).toBe(200);
    expect(res2.json().sp).toBe(maxSp);
    expect(Number((await invRowsOf()).find((r) => r.id === spPotion)!.quantity)).toBe(2);

    // 非消耗品 400，且不扣减
    const mat = await insertRow("kunchong_waike", 1, 5);
    const res3 = await useReq(mat);
    expect(res3.statusCode).toBe(400);
    expect(Number((await invRowsOf()).find((r) => r.id === mat)!.quantity)).toBe(5);
    await freshBag();
  });

  it("active 战斗中 409（先开一场战斗再 use）", async () => {
    await freshBag();
    // 手插一只实例 + active 战斗行（battles 外键引用实例）
    const [inst] = await getPool().query<ResultSetHeader>(
      `INSERT INTO map_node_monsters (map_code, node_code, monster_code, hp, max_hp, status)
       VALUES ('muye_caoyuan', 'my03', 'paopao', 10, 10, 'alive')`,
    );
    try {
      await getPool().query(
        `INSERT INTO battles (character_id, monster_instance_id, monster_code, status, state, started_at)
         VALUES (?, ?, 'paopao', 'active', '{}', NOW())`,
        [charId, inst.insertId],
      );
      const potion = await insertRow("xiaoxing_buxueji", 0, 3);
      const res = await useReq(potion);
      expect(res.statusCode).toBe(409);
      expect(res.json().message).toBe("战斗中无法使用物品");
      expect(Number((await invRowsOf()).find((r) => r.id === potion)!.quantity)).toBe(3); // 未扣减
    } finally {
      await getPool().query("DELETE FROM battles WHERE character_id = ?", [charId]);
      await getPool().query("DELETE FROM map_node_monsters WHERE id = ?", [inst.insertId]);
      await freshBag();
    }
  });
});

// ---------- discard 丢弃 ----------

describe("POST /api/inventory/discard", () => {
  it("整堆丢弃删行；带 quantity 部分丢弃减量；已穿戴（slot_index NULL）400", async () => {
    await freshBag();
    const whole = await insertRow("kunchong_waike", 0, 10);
    expect((await discardReq(whole)).statusCode).toBe(200);
    expect((await invRowsOf()).find((r) => r.id === whole)).toBeUndefined();

    const partial = await insertRow("kunchong_waike", 0, 10);
    expect((await discardReq(partial, 4)).statusCode).toBe(200);
    expect(Number((await invRowsOf()).find((r) => r.id === partial)!.quantity)).toBe(6);

    // GREATEST(0, ...) 口径：丢弃量大于存量 → 归零删行
    expect((await discardReq(partial, 99)).statusCode).toBe(200);
    expect((await invRowsOf()).find((r) => r.id === partial)).toBeUndefined();

    // 已穿戴 400，装备未丢
    const wornSword = await insertRow("nongfuzhijian", null, 1, 10);
    await bindEquip("main_hand", wornSword);
    const res = await discardReq(wornSword);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe("已穿戴的装备不能丢弃");
    expect((await invRowsOf())).toHaveLength(1);
  });

  it("inventoryId 不存在 404", async () => {
    const res = await discardReq(999999);
    expect(res.statusCode).toBe(404);
  });
});

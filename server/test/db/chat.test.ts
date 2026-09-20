import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.ts";
import { resetDb, registerAndLogin, cookieOf } from "./helpers.ts";

const app = buildApp();

/** 建号→建角→选角，返回选角后的 cookie */
async function makeCharacter(username: string, name: string): Promise<string> {
  const cookie = await registerAndLogin(app, username);
  const created = await app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie },
    payload: { name, breedCode: "mao", profession: "warrior" },
  });
  expect(created.statusCode).toBe(201);
  const select = await app.inject({
    method: "POST",
    url: "/api/auth/select-character",
    headers: { cookie },
    payload: { characterId: created.json().id },
  });
  return cookieOf(select);
}

let aCookie = ""; // 甲猫：广场 guangchang
let bCookie = ""; // 乙猫：广场 guangchang
let cCookie = ""; // 丙猫：村口 cunkou

beforeAll(async () => {
  await resetDb();
  aCookie = await makeCharacter("chata", "甲猫");
  bCookie = await makeCharacter("chatb", "乙猫");
  cCookie = await makeCharacter("chatc", "丙猫");
  await app.inject({
    method: "POST",
    url: "/api/map/move",
    headers: { cookie: cCookie },
    payload: { toCode: "cunkou" },
  });
});

afterAll(async () => {
  await app.close();
});

describe("聊天", () => {
  it("未登录访问消息接口返回 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/chat/messages" });
    expect(res.statusCode).toBe(401);
  });

  it("公会/队伍频道发送返回 400 暂未开放", async () => {
    for (const channel of ["guild", "team"]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/chat/send",
        headers: { cookie: aCookie },
        payload: { channel, content: "打招呼" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("暂未开放");
    }
  });

  it("私聊参数校验：目标不存在 404 / 私聊自己 400 / 缺目标名 400", async () => {
    const notFound = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      headers: { cookie: aCookie },
      payload: { channel: "private", content: "在吗", targetName: "不存在猫" },
    });
    expect(notFound.statusCode).toBe(404);

    const self = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      headers: { cookie: aCookie },
      payload: { channel: "private", content: "自言自语", targetName: "甲猫" },
    });
    expect(self.statusCode).toBe(400);

    const noTarget = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      headers: { cookie: aCookie },
      payload: { channel: "private", content: "没写名字" },
    });
    expect(noTarget.statusCode).toBe(400);
  });

  it("区域聊：发送成功返回结构化字段；同格可见、异格不可见", async () => {
    const send = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      headers: { cookie: aCookie },
      payload: { channel: "area", content: "广场集合" },
    });
    expect(send.statusCode).toBe(200);
    expect(send.json().message).toMatchObject({
      channel: "area",
      senderName: "甲猫",
      content: "广场集合",
    });

    // 乙猫同在广场 → 可见
    const seen = await app.inject({
      method: "GET",
      url: "/api/chat/messages",
      headers: { cookie: bCookie },
    });
    expect(seen.json().messages.some((m: { content: string }) => m.content === "广场集合")).toBe(true);

    // 丙猫在村口 → 不可见
    const other = await app.inject({
      method: "GET",
      url: "/api/chat/messages",
      headers: { cookie: cCookie },
    });
    expect(other.json().messages.some((m: { content: string }) => m.content === "广场集合")).toBe(false);
  });

  it("区域聊：sinceId 增量只返回更新的消息", async () => {
    const all = await app.inject({
      method: "GET",
      url: "/api/chat/messages",
      headers: { cookie: bCookie },
    });
    const ids: number[] = all.json().messages.map((m: { id: number }) => m.id);
    const maxId = Math.max(...ids);

    await app.inject({
      method: "POST",
      url: "/api/chat/send",
      headers: { cookie: aCookie },
      payload: { channel: "area", content: "第二条区域消息" },
    });

    const inc = await app.inject({
      method: "GET",
      url: `/api/chat/messages?sinceId=${maxId}`,
      headers: { cookie: bCookie },
    });
    const list = inc.json().messages;
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe("第二条区域消息");
  });

  it("私聊成功：双方轮询均可见，第三方不可见", async () => {
    const send = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      headers: { cookie: bCookie },
      payload: { channel: "private", content: "偷偷说一句", targetName: "甲猫" },
    });
    expect(send.statusCode).toBe(200);
    expect(send.json().message).toMatchObject({ senderName: "乙猫", targetName: "甲猫", content: "偷偷说一句" });

    const asTarget = await app.inject({
      method: "GET",
      url: "/api/chat/messages",
      headers: { cookie: aCookie },
    });
    expect(asTarget.json().messages.some((m: { content: string }) => m.content === "偷偷说一句")).toBe(true);

    const asSender = await app.inject({
      method: "GET",
      url: "/api/chat/messages",
      headers: { cookie: bCookie },
    });
    expect(asSender.json().messages.some((m: { content: string }) => m.content === "偷偷说一句")).toBe(true);

    const outsider = await app.inject({
      method: "GET",
      url: "/api/chat/messages",
      headers: { cookie: cCookie },
    });
    expect(outsider.json().messages.some((m: { content: string }) => m.content === "偷偷说一句")).toBe(false);
  });

  it("世界聊：同角色 10 秒内第二条被拒，其他角色不受影响", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      headers: { cookie: aCookie },
      payload: { channel: "world", content: "世界第一条" },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      headers: { cookie: aCookie },
      payload: { channel: "world", content: "世界第二条" },
    });
    expect(second.statusCode).toBe(400);
    expect(second.json().message).toContain("10秒");

    const byOther = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      headers: { cookie: bCookie },
      payload: { channel: "world", content: "世界你好" },
    });
    expect(byOther.statusCode).toBe(200);
  });

  it("消息列表按 id 升序返回", async () => {
    // 注：无 sinceId 的「最新 50 条」上限不在本测试断言（需造 51 条数据，成本不划算），实现侧以 LIMIT 50 兜底
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/messages",
      headers: { cookie: bCookie },
    });
    const ids: number[] = res.json().messages.map((m: { id: number }) => m.id);
    const sorted = [...ids].sort((x, y) => x - y);
    expect(ids).toEqual(sorted);
    expect(ids.length).toBeGreaterThanOrEqual(5);
  });
});

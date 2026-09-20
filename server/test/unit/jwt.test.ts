import { describe, expect, it } from "vitest";
import { signJwt, verifyJwt } from "../../src/lib/jwt.js";

const SECRET = "test-secret";

describe("JWT HS256", () => {
  it("签发后可验证并携带账号与角色", () => {
    const token = signJwt({ accountId: 7, characterId: 3 }, SECRET, 60);
    expect(verifyJwt(token, SECRET)).toMatchObject({ accountId: 7, characterId: 3 });
  });

  it("密钥不同则验证失败", () => {
    const token = signJwt({ accountId: 7 }, SECRET, 60);
    expect(verifyJwt(token, "other")).toBeNull();
  });

  it("过期返回 null", () => {
    const token = signJwt({ accountId: 7 }, SECRET, -1);
    expect(verifyJwt(token, SECRET)).toBeNull();
  });

  it("篡改 payload 返回 null", () => {
    const token = signJwt({ accountId: 7 }, SECRET, 60);
    const [h, p, s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ accountId: 999, exp: 9e12, iat: 0 })).toString("base64url");
    expect(verifyJwt(`${h}.${forged}.${s}`, SECRET)).toBeNull();
  });
});

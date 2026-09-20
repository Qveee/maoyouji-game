import { createHmac, timingSafeEqual } from "node:crypto";

export interface JwtPayload {
  accountId: number;
  characterId?: number;
  exp: number;
  iat: number;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function signature(data: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

export function signJwt(payload: Omit<JwtPayload, "exp" | "iat">, secret: string, ttlSec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const body: JwtPayload = { ...payload, iat: now, exp: now + ttlSec };
  const data = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(body))}`;
  return `${data}.${b64url(signature(data, secret))}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expected = signature(data, secret);
  const actual = Buffer.from(parts[2]!, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as JwtPayload;
    if (typeof payload.accountId !== "number" || typeof payload.exp !== "number") return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

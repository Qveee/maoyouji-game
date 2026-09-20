export interface Character {
  id: number;
  name: string;
  profession: "warrior" | "mage";
  breedCode: string;
  level: number;
  exp: number;
  vit: number;
  str: number;
  agi: number;
  intel: number;
  spr: number;
  hp: number;
  sp: number;
}

export interface Pet {
  code: string;
  name: string;
  description: string;
  sprite: string;
  baseStats: Record<string, number>;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body != null;
  const res = await fetch(url, {
    ...init,
    headers: { ...(hasBody ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) {
    throw new Error(body.message ?? `请求失败(${res.status})`);
  }
  return body;
}

export const api = {
  register: (username: string, password: string) =>
    request<{ username: string }>("/api/auth/register", { method: "POST", body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) =>
    request<{ username: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  me: () => request<{ username: string; characterId: number | null }>("/api/auth/me"),
  characters: () => request<{ characters: Character[] }>("/api/characters"),
  createCharacter: (name: string, breedCode: string, profession: "warrior" | "mage") =>
    request<Character>("/api/characters", { method: "POST", body: JSON.stringify({ name, breedCode, profession }) }),
  deleteCharacter: (id: number) => request<{ ok: boolean }>(`/api/characters/${id}`, { method: "DELETE" }),
  selectCharacter: (characterId: number) =>
    request<{ characterId: number }>("/api/auth/select-character", { method: "POST", body: JSON.stringify({ characterId }) }),
  pets: () => request<{ pets: Pet[] }>("/api/pets"),
};

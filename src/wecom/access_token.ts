import type { CustomerBridgeConfig } from "../types.js";

interface CachedToken {
  token: string;
  expiresAt: number;
}

const cache = new Map<string, CachedToken>();

export async function getAccessToken(config: CustomerBridgeConfig): Promise<string> {
  const key = `${config.wecomCorpId}:${config.wecomAgentId}`;
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) {
    return cached.token;
  }

  const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/gettoken");
  url.searchParams.set("corpid", config.wecomCorpId);
  url.searchParams.set("corpsecret", config.wecomSecret);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`gettoken HTTP ${res.status}`);
  }
  const body = (await res.json()) as { errcode?: number; errmsg?: string; access_token?: string; expires_in?: number };
  if (body.errcode && body.errcode !== 0) {
    throw new Error(`gettoken errcode=${body.errcode} errmsg=${body.errmsg}`);
  }
  if (!body.access_token || !body.expires_in) {
    throw new Error("gettoken response missing access_token or expires_in");
  }
  const token = body.access_token;
  cache.set(key, { token, expiresAt: now + body.expires_in * 1000 });
  return token;
}

export async function callWecomApi<T = unknown>(
  config: CustomerBridgeConfig,
  path: string,
  payload: unknown
): Promise<T> {
  const token = await getAccessToken(config);
  const url = new URL(`https://qyapi.weixin.qq.com/cgi-bin/${path}`);
  url.searchParams.set("access_token", token);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`WeCom ${path} HTTP ${res.status}`);
  }
  const body = (await res.json()) as { errcode?: number; errmsg?: string };
  if (body.errcode && body.errcode !== 0) {
    throw new Error(`WeCom ${path} errcode=${body.errcode} errmsg=${body.errmsg}`);
  }
  return body as T;
}

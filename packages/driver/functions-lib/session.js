// Session cookie helpers: "<base64url(json)>.<base64url(hmac-sha256)>".
// The HMAC key is generated once and kept in KV, so no secret has to be configured by hand.
const COOKIE = "pob_session";
const SECRET_KEY = "config:session-secret";
export const SESSION_DAYS = 30;

const enc = new TextEncoder();
const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text) => {
  const s = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

let cachedKey;

async function hmacKey(env) {
  if (cachedKey) return cachedKey;
  cachedKey = await loadHmacKey(env);
  return cachedKey;
}

async function loadHmacKey(env) {
  let secret = await env.KV.get(SECRET_KEY);
  if (!secret) {
    secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
    await env.KV.put(SECRET_KEY, secret);
  }
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function makeSessionCookie(env, claims) {
  const payload = b64url(enc.encode(JSON.stringify({
    ...claims,
    exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
  })));
  const sig = b64url(await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode(payload)));
  return `${COOKIE}=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export const clearSessionCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export async function readSession(request, env) {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return undefined;
  const [payload, sig] = match[1].split(".");
  if (!payload || !sig) return undefined;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(env), fromB64url(sig), enc.encode(payload));
    if (!ok) return undefined;
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    if (!claims.sub || !claims.exp || claims.exp < Date.now() / 1000) return undefined;
    return claims;
  } catch {
    return undefined;
  }
}

// Verifies a Google ID token (RS256) against Google's published keys.
export async function verifyGoogleIdToken(idToken, clientId) {
  const [h, p, s] = idToken.split(".");
  if (!h || !p || !s) throw new Error("malformed token");
  const header = JSON.parse(new TextDecoder().decode(fromB64url(h)));
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(p)));
  const certs = await (await fetch("https://www.googleapis.com/oauth2/v3/certs")).json();
  const jwk = certs.keys.find((k) => k.kid === header.kid);
  if (!jwk || header.alg !== "RS256") throw new Error("unknown key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
    "verify",
  ]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64url(s), enc.encode(`${h}.${p}`));
  if (!ok) throw new Error("bad signature");
  if (!["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)) throw new Error("bad issuer");
  if (claims.aud !== clientId) throw new Error("bad audience");
  if (claims.exp < Date.now() / 1000) throw new Error("expired");
  return claims;
}

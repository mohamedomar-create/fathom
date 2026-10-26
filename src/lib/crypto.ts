import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function missingKey(): never {
  // Vercel's own deployment labels (not secret): a key added for Production only is missing on a branch's Preview.
  const env = process.env.VERCEL_ENV, ref = process.env.VERCEL_GIT_COMMIT_REF;
  if (env) {
    const tick = env === "production" ? "Production" : env === "preview" ? "Preview" : "Development";
    throw new Error(`ENCRYPTION_KEY is not set for this deployment (${env}${ref ? `, branch ${ref}` : ""}). In Vercel → Settings → Environment Variables, tick ${tick} for ENCRYPTION_KEY, then redeploy this deployment.`);
  }
  throw new Error("ENCRYPTION_KEY is not set on the server. Add it in Vercel → Settings → Environment Variables (openssl rand -base64 32).");
}

const bytes = (k: string, name: string) => {
  const b = Buffer.from(k, "base64");
  if (b.length !== 32) throw new Error(`${name} must be 32 bytes, base64-encoded (openssl rand -base64 32).`);
  return b;
};

/**
 * The key ring: ENCRYPTION_KEYS ("id:base64,id:base64", the first is the one new values use) for rotation, and
 * ENCRYPTION_KEY, which is key "k1" and reads values saved before rotation existed.
 */
function ring(): { current: string; keys: Map<string, Buffer> } {
  const keys = new Map<string, Buffer>();
  let current = "";
  for (const part of (process.env.ENCRYPTION_KEYS ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const [id, k] = part.split(":");
    if (!id || !k || !/^[a-z0-9]{1,12}$/i.test(id)) throw new Error("ENCRYPTION_KEYS must look like k2:<base64>,k1:<base64>.");
    keys.set(id, bytes(k, `ENCRYPTION_KEYS (${id})`));
    current ||= id;
  }
  if (process.env.ENCRYPTION_KEY && !keys.has("k1")) keys.set("k1", bytes(process.env.ENCRYPTION_KEY, "ENCRYPTION_KEY"));
  current ||= keys.has("k1") ? "k1" : "";
  if (!current) missingKey();
  return { current, keys };
}

function keyById(id: string): Buffer {
  const k = ring().keys.get(id);
  if (!k) throw new Error(`This value was saved with encryption key ${id}, which is no longer on the server. Add it back to ENCRYPTION_KEYS, or enter the API key again.`);
  return k;
}

/**
 * AES-256-GCM. New values: v3.<key id>.<iv>.<tag>.<ciphertext> (base64url) bound to a context (`aad`), so a copy moved
 * elsewhere (another company, another server) is useless, or v3u.… with no context. v1 (no context) and v2 (bound)
 * values from before the key ring are read with key k1.
 */
export function encrypt(plain: string, aad?: string): string {
  const { current, keys } = ring();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keys.get(current)!, iv);
  if (aad !== undefined) c.setAAD(Buffer.from(aad, "utf8"));
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [aad !== undefined ? "v3" : "v3u", current, iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decrypt(token: string, aad?: string): string {
  const parts = token.split(".");
  const v = parts[0];
  let kid: string, iv: string, tag: string, data: string;
  const ringed = v === "v3" || v === "v3u";
  if (ringed) [, kid, iv, tag, data] = parts;
  else { [, iv, tag, data] = parts; kid = "k1"; }
  if ((v !== "v1" && v !== "v2" && !ringed) || !kid || !iv || !tag || !data) throw new Error("Unrecognised encrypted value");
  const bound = v === "v2" || v === "v3";
  if (aad !== undefined && !bound) throw new Error("Enter the API key again: it was saved before keys were tied to their connection.");
  if (bound && aad === undefined) throw new Error("Unrecognised encrypted value");
  const d = createDecipheriv("aes-256-gcm", keyById(kid), Buffer.from(iv, "base64url"));
  if (aad !== undefined) d.setAAD(Buffer.from(aad, "utf8"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

/** The same secret under the current key (key rotation): old keys can then be taken off the server. */
export const reencrypt = (token: string, aad?: string) => encrypt(decrypt(token, aad), aad);

/** True when a saved value is not under the server's current key (or is an older format): re-encrypt it, then the old key can go. */
export function usesOldKey(token: string): boolean {
  const [v, kid] = token.split(".");
  return !(v === "v3" || v === "v3u") || kid !== ring().current;
}

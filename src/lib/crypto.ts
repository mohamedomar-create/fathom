import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) {
    // Vercel's own deployment labels (not secret): a key added for Production only is missing on a branch's Preview.
    const env = process.env.VERCEL_ENV, ref = process.env.VERCEL_GIT_COMMIT_REF;
    if (env) {
      const tick = env === "production" ? "Production" : env === "preview" ? "Preview" : "Development";
      throw new Error(`ENCRYPTION_KEY is not set for this deployment (${env}${ref ? `, branch ${ref}` : ""}). In Vercel → Settings → Environment Variables, tick ${tick} for ENCRYPTION_KEY, then redeploy this deployment.`);
    }
    throw new Error("ENCRYPTION_KEY is not set on the server. Add it in Vercel → Settings → Environment Variables (openssl rand -base64 32).");
  }
  const b = Buffer.from(k, "base64");
  if (b.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).");
  return b;
}

/**
 * AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url), or v2.… when bound to a context (`aad`): a v2 value
 * decrypts only with the same context, so a copy of it moved elsewhere (another company, another server) is useless.
 */
export function encrypt(plain: string, aad?: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  if (aad !== undefined) c.setAAD(Buffer.from(aad, "utf8"));
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [aad !== undefined ? "v2" : "v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decrypt(token: string, aad?: string): string {
  const [v, iv, tag, data] = token.split(".");
  if ((v !== "v1" && v !== "v2") || !iv || !tag || !data) throw new Error("Unrecognised encrypted value");
  if (aad !== undefined && v !== "v2") throw new Error("Enter the API key again: it was saved before keys were tied to their connection.");
  if (v === "v2" && aad === undefined) throw new Error("Unrecognised encrypted value");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  if (v === "v2") d.setAAD(Buffer.from(aad!, "utf8"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

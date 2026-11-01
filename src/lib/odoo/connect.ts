import "server-only";
import { decrypt } from "@/lib/crypto";
import { majorVersion, OdooClient } from "./client";
import { pinnedFetch, resolvePublicOdoo } from "./net";
import { trust, Version } from "./schema";

/** What a saved key is bound to: a copy moved to another company, address, database or login cannot be decrypted. */
export const bindingOf = (companyId: string, url: string, db: string, login: string) => `odoo\n${companyId}\n${url}\n${db}\n${login}`;

/** The saved key in plain text, only for the company, address, database and login it was saved for. */
export const openKey = (enc: string, companyId: string, url: string, db: string, login: string) => {
  try { return decrypt(enc, bindingOf(companyId, url, db, login)); }
  catch (e) { throw new Error(/again/.test((e as Error).message) ? (e as Error).message : "Enter the API key again: the saved key doesn't belong to this connection."); }
};

/** A client that talks only to the address that passed the public-internet check. */
export async function connect(rawUrl: string, db: string, login: string, key: string, deadline = Infinity) {
  const target = await resolvePublicOdoo(rawUrl);
  return { url: target.url, client: new OdooClient(target.url, db, login, key, pinnedFetch(target), 25_000, deadline) };
}

/** Odoo's major version, checked. */
export async function probeVersion(client: OdooClient): Promise<number> {
  const v = trust(Version, await client.version(), "version");
  return majorVersion(v.server_version_info, v.server_version);
}

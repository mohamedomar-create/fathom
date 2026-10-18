export type Fetch = typeof fetch;

export class OdooError extends Error {
  constructor(message: string, public readonly detail?: string) { super(message); }
}

/** The only Odoo methods iReport ever sends: it reads a company's books and never changes them. */
export const READ_METHODS: ReadonlySet<string> = new Set(["search_read", "read", "read_group", "search_count", "fields_get"]);
/** Services and methods the raw call may use besides execute_kw with a reading method: logging in and the version. */
const OPEN_CALLS = new Set(["common.version", "common.authenticate"]);
/** The only Odoo models iReport reads. res.users is read for the connected user's own record only (its name and companies). */
export const READ_MODELS: ReadonlySet<string> = new Set(["res.company", "res.users", "account.account", "ir.model.data", "account.move.line", "account.move"]);
/**
 * Odoo's own questions "may this user create / change / delete these records?", asked to prove the connected user cannot
 * change anything. They answer yes or no and change nothing: check_access_rights (Odoo 13–17, kept in 18) and has_access (18+).
 */
export const RIGHTS_METHODS: ReadonlySet<string> = new Set(["check_access_rights", "has_access"]);
const RIGHTS_OPS = new Set(["create", "write", "unlink"]);
/** Accounting records a read-only user must not be able to create, change or delete. */
export const GUARDED_MODELS = ["account.move", "account.account", "account.journal", "account.payment"] as const;

/** Server-wide stop for every Odoo call (Vercel setting ODOO_SYNC_DISABLED=1). */
export const odooDisabled = () => /^(1|true|yes)$/i.test(process.env.ODOO_SYNC_DISABLED ?? "");

/** What execute_kw may send: a reading method on an allowed model, or a rights question on a guarded model. */
function allowedKw(model: string, method: string, args: unknown[], kwargs: Record<string, unknown>, uid: number | null): string | null {
  if (RIGHTS_METHODS.has(method)) {
    if (!(GUARDED_MODELS as readonly string[]).includes(model)) return `"${method}" on ${model}`;
    const op = method === "has_access" ? args[1] : args[0];
    if (typeof op !== "string" || !RIGHTS_OPS.has(op)) return `"${method}" with "${String(op)}"`;
    if (method === "has_access" && !(Array.isArray(args[0]) && args[0].length === 0)) return `"${method}" on records`;
    if (method === "check_access_rights" && kwargs.raise_exception !== false) return `"${method}" that raises`;
    return null;
  }
  if (!READ_METHODS.has(method)) return `"${method}"`;
  if (!READ_MODELS.has(model)) return `reading ${model}`;
  // The connected user's own record, nobody else's.
  if (model === "res.users" && !(method === "read" && uid !== null && Array.isArray(args[0]) && args[0].length === 1 && args[0][0] === uid)) return "reading other Odoo users";
  return null;
}

/** Minimal Odoo external API client over /jsonrpc (works on Odoo 13–18; 19 keeps /jsonrpc available with a deprecation notice). */
export class OdooClient {
  private uid: number | null = null;
  private id = 0;
  /** deadline: a time (ms since epoch) after which no further request is sent, so a sync stops cleanly instead of half-way. */
  constructor(readonly url: string, readonly db: string, readonly login: string, private readonly apiKey: string, private readonly fetchImpl: Fetch = fetch, private readonly timeoutMs = 25_000, private readonly deadline = Infinity) {}

  private async call<T>(service: string, method: string, args: unknown[]): Promise<T> {
    if (odooDisabled()) throw new OdooError("The Odoo connection is switched off on this server (ODOO_SYNC_DISABLED).");
    // Read-only, enforced here where every request leaves: nothing that writes can reach Odoo, whoever asks.
    const kw = service === "object" && method === "execute_kw";
    const refused = kw ? allowedKw(String(args[3]), String(args[4]), (args[5] ?? []) as unknown[], (args[6] ?? {}) as Record<string, unknown>, typeof args[1] === "number" ? args[1] : null)
      : OPEN_CALLS.has(`${service}.${method}`) ? null : `"${service}.${method}"`;
    if (refused) throw new OdooError(`iReport only reads from Odoo; ${refused} is not allowed.`);
    if (Date.now() > this.deadline) throw new OdooError("Odoo took too long: the sync stopped before finishing and nothing was saved. Try again, or sync fewer months.");
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.url}/jsonrpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id: ++this.id }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new OdooError(this.scrub(`Could not reach Odoo at ${this.url} (${(e as Error).name === "TimeoutError" ? "timed out" : (e as Error).message}).`));
    }
    if (res.status >= 300 && res.status < 400) throw new OdooError(`Odoo redirected the request (HTTP ${res.status}). Enter the final https:// address of your Odoo, e.g. https://yourcompany.odoo.com.`);
    if (!res.ok) throw new OdooError(`Odoo answered HTTP ${res.status}. Check the URL${res.status === 404 ? " (is the external API enabled? Odoo Online needs the Custom plan)" : ""}.`);
    // Odoo answers JSON-RPC with application/json; anything else (a login page, a proxy's error page) is not Odoo.
    if (!/json/i.test(res.headers.get("content-type") ?? "")) throw new OdooError("The address did not answer like Odoo's API (not JSON). Check the URL.");
    let body: { result?: T; error?: { message?: string; data?: { message?: string; name?: string } } };
    try { body = await res.json(); } catch { throw new OdooError("Odoo returned something that is not JSON. Is this the right URL?"); }
    if (body.error) {
      const msg = this.scrub(String(body.error.data?.message || body.error.message || "Odoo error"));
      throw new OdooError(friendly(msg, body.error.data?.name), msg);
    }
    return body.result as T;
  }

  /** The key never travels in an error, even when Odoo or the network echoes it back. */
  private scrub(text: string) { return this.apiKey.length >= 4 ? text.split(this.apiKey).join("[key]") : text; }

  version() { return this.call<{ server_version: string; server_version_info: (number | string)[] }>("common", "version", []); }

  async authenticate(): Promise<number> {
    const uid = await this.call<number | false>("common", "authenticate", [this.db, this.login, this.apiKey, {}]);
    if (!uid) throw new OdooError("Odoo rejected the login. Check the database name, login (email) and API key.");
    this.uid = uid;
    return uid;
  }

  async executeKw<T>(model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}): Promise<T> {
    // Refused before anything is sent (only the user's own record needs the user id first).
    if (this.uid === null && model === "res.users") await this.authenticate();
    const refused = allowedKw(model, method, args, kwargs, this.uid);
    if (refused) throw new OdooError(`iReport only reads from Odoo; ${refused} is not allowed.`);
    if (this.uid === null) await this.authenticate();
    return this.call<T>("object", "execute_kw", [this.db, this.uid, this.apiKey, model, method, args, kwargs]);
  }
}

function friendly(msg: string, name?: string) {
  if (/AccessDenied|Access Denied/i.test(msg + name)) return "Access denied by Odoo. Check the login and API key.";
  if (/database .* does not exist|KeyError: '.*'/i.test(msg)) return "That database name was not found on this Odoo server.";
  if (/AccessError/i.test(name ?? "")) return "This Odoo user cannot read accounting data. Give it the Accounting / Billing Administrator or 'Read-only' accounting rights.";
  return msg.split("\n")[0].slice(0, 300);
}

export function majorVersion(info: (number | string)[] | undefined, serverVersion = ""): number {
  const first = info?.[0];
  if (typeof first === "number") return first;
  const m = String(first ?? serverVersion).match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

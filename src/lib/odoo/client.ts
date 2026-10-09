export type Fetch = typeof fetch;

export class OdooError extends Error {
  constructor(message: string, public readonly detail?: string) { super(message); }
}

/** Minimal Odoo external API client over /jsonrpc (works on Odoo 13–18; 19 keeps /jsonrpc available with a deprecation notice). */
export class OdooClient {
  private uid: number | null = null;
  private id = 0;
  constructor(readonly url: string, readonly db: string, readonly login: string, private readonly apiKey: string, private readonly fetchImpl: Fetch = fetch, private readonly timeoutMs = 25_000) {}

  async call<T>(service: string, method: string, args: unknown[]): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.url}/jsonrpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id: ++this.id }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new OdooError(`Could not reach Odoo at ${this.url} (${(e as Error).name === "TimeoutError" ? "timed out" : (e as Error).message}).`);
    }
    if (!res.ok) throw new OdooError(`Odoo answered HTTP ${res.status}. Check the URL${res.status === 404 ? " (is the external API enabled? Odoo Online needs the Custom plan)" : ""}.`);
    let body: { result?: T; error?: { message?: string; data?: { message?: string; name?: string } } };
    try { body = await res.json(); } catch { throw new OdooError("Odoo returned something that is not JSON. Is this the right URL?"); }
    if (body.error) {
      const msg = body.error.data?.message || body.error.message || "Odoo error";
      throw new OdooError(friendly(msg, body.error.data?.name), msg);
    }
    return body.result as T;
  }

  version() { return this.call<{ server_version: string; server_version_info: (number | string)[] }>("common", "version", []); }

  async authenticate(): Promise<number> {
    const uid = await this.call<number | false>("common", "authenticate", [this.db, this.login, this.apiKey, {}]);
    if (!uid) throw new OdooError("Odoo rejected the login. Check the database name, login (email) and API key.");
    this.uid = uid;
    return uid;
  }

  async executeKw<T>(model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}): Promise<T> {
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

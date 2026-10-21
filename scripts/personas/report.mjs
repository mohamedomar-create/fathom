// Gathers every persona's issues, the server log, the database log and the import worker log into one Markdown file:
// docs/PERSONA_TEST_ISSUES.md. Issues are grouped by what went wrong (ids and numbers normalised), ranked by severity
// and by how many personas hit them, each with the personas, steps, pages and evidence.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const OUT = path.join(ROOT, "test-results/personas");
const DOC = path.join(ROOT, process.env.PERSONA_REPORT ?? "docs/PERSONA_TEST_ISSUES.md");
const RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const read = (f) => (fs.existsSync(path.join(OUT, f)) ? fs.readFileSync(path.join(OUT, f), "utf8") : "");
const norm = (s) => s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ":id").replace(/-[a-z0-9]{6,9}-\d+@test\.local/g, "@test").replace(/\b\d+(\.\d+)?\s?(s|ms|KB)\b/g, "N $2").replace(/\b\d{2,}\b/g, "N").replace(/\?.*$/, "").trim();
const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

const personas = fs.readdirSync(OUT).filter((f) => /^P\d+\.json$/.test(f)).sort().map((f) => JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8")));

// ── issues seen in the browser
const groups = new Map();
for (const p of personas) for (const i of p.issues) {
  const key = `${i.kind}|${norm(i.message)}`;
  const g = groups.get(key) ?? { kind: i.kind, message: norm(i.message), severity: i.severity, personas: new Set(), hits: 0, examples: [] };
  if (RANK[i.severity] < RANK[g.severity]) g.severity = i.severity;
  g.personas.add(`${p.id} ${p.name}`);
  g.hits++;
  if (g.examples.length < 3) g.examples.push({ persona: p.id, step: i.step, url: i.url.replace(/[0-9a-f-]{36}/g, ":id"), evidence: i.evidence, raw: i.message });
  groups.set(key, g);
}

// ── server log: op lines that failed, and anything printed as an error
const server = read("server.log").split("\n");
const serverGroups = new Map();
for (const line of server) {
  let key, sev = "high", text;
  if (line.startsWith("{") && line.includes('"kind":"op"')) {
    try {
      const o = JSON.parse(line);
      if (o.outcome === "ok") continue;
      sev = o.outcome === "failed" ? "high" : "medium";
      text = `op ${o.op} ${o.outcome}${o.code ? ` (code ${o.code})` : ""}${o.attempt > 1 ? ` after ${o.attempt} attempts` : ""}`;
    } catch { continue; }
  } else if (/\b(Error|error|ERR_|Unhandled|TypeError|ReferenceError|digest)\b/.test(line) && !/^\s*at /.test(line)) {
    text = line.trim().slice(0, 240);
    if (/DeprecationWarning|ExperimentalWarning/.test(text)) { sev = "low"; }
  } else continue;
  key = norm(text);
  const g = serverGroups.get(key) ?? { text: key, severity: sev, hits: 0 };
  g.hits++;
  serverGroups.set(key, g);
}

// ── database log: errors and slow statements
const pgGroups = new Map();
for (const line of read("postgres.log").split("\n")) {
  const m = line.match(/(ERROR|FATAL|PANIC|WARNING):\s+(.*)/);
  if (!m) continue;
  const text = norm(m[2]).slice(0, 220);
  const sev = m[1] === "WARNING" ? "low" : /timeout|deadlock|could not serialize|out of memory/.test(text) ? "high" : "medium";
  const g = pgGroups.get(text) ?? { text, level: m[1], severity: sev, hits: 0 };
  g.hits++;
  pgGroups.set(text, g);
}
const importErrors = read("imports.log").split("\n").filter((l) => /ERROR|error/.test(l)).map(norm);
const importGroups = [...new Set(importErrors)].map((t) => ({ text: t.slice(0, 220), hits: importErrors.filter((x) => x === t).length }));

// ── timings
const times = personas.flatMap((p) => p.timings.filter((t) => !t.url.startsWith("[")));
const byPage = new Map();
for (const t of times) { const k = t.url.replace(/\?.*$/, ""); byPage.set(k, [...(byPage.get(k) ?? []), t.ms]); }
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const pages = [...byPage.entries()].map(([url, ms]) => ({ url, n: ms.length, p50: pct(ms, 0.5), p95: pct(ms, 0.95), max: Math.max(...ms) })).sort((a, b) => b.p95 - a.p95);
const all = times.map((t) => t.ms);

// ── write
const list = [...groups.values()].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.personas.size - a.personas.size || b.hits - a.hits);
const count = (sev) => list.filter((g) => g.severity === sev).length;
const stepsTotal = personas.reduce((s, p) => s + p.steps.length, 0), stepsFailed = personas.reduce((s, p) => s + p.steps.filter((x) => !x.ok).length, 0);
const L = [];
L.push("# Persona test run: issues to address", "");
L.push(`Run on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC against a disposable local stack (fresh database, production build, the live database's time limits). Made-up companies and files only; nothing touched production.`, "");
L.push(`- **Personas:** ${personas.length} · **steps:** ${stepsTotal} (${stepsFailed} failed or skipped) · **page loads timed:** ${all.length} · **run time:** ${Math.round(Number(read("duration") || 0) / 60)} min`);
L.push(`- **Distinct issues (browser):** ${list.length}: ${count("critical")} critical, ${count("high")} high, ${count("medium")} medium, ${count("low")} low`);
L.push(`- **Server log:** ${[...serverGroups.values()].reduce((s, g) => s + g.hits, 0)} problem lines in ${serverGroups.size} kinds · **database log:** ${[...pgGroups.values()].reduce((s, g) => s + g.hits, 0)} errors/warnings in ${pgGroups.size} kinds`);
if (all.length) L.push(`- **Page load times:** median ${(pct(all, 0.5) / 1000).toFixed(2)} s, p95 ${(pct(all, 0.95) / 1000).toFixed(2)} s, slowest ${(Math.max(...all) / 1000).toFixed(1)} s`);
L.push("", "Severity: **critical** = wrong figures, data leak or data loss; **high** = crash, server error, security gap or a broken journey; **medium** = confusing, slow or partly broken; **low** = polish.", "");
L.push("Each issue is a lead, not a verdict: some are expected behaviour or test-harness assumptions. Check each before fixing it.", "");

L.push("## 1. Issues found by the personas", "");
L.push("| # | Severity | Kind | Issue | Personas | Hits |", "|---|---|---|---|---|---|");
list.forEach((g, i) => L.push(`| B${i + 1} | ${g.severity} | ${esc(g.kind)} | ${esc(g.message).slice(0, 220)} | ${g.personas.size} | ${g.hits} |`));
L.push("", "### Details", "");
list.forEach((g, i) => {
  L.push(`**B${i + 1}. [${g.severity}] ${esc(g.kind)}: ${esc(g.message).slice(0, 200)}**`, "");
  L.push(`- Personas: ${[...g.personas].join("; ")}`);
  for (const e of g.examples) L.push(`- ${e.persona}, step "${esc(e.step)}"${e.url ? `, page \`${e.url}\`` : ""}${e.evidence ? `, screenshot \`${e.evidence}\`` : ""}: ${esc(e.raw).slice(0, 300)}`);
  L.push("");
});

L.push("## 2. Server log (Next.js)", "");
if (!serverGroups.size) L.push("No failed operations or errors.", "");
else { L.push("| # | Severity | Line (normalised) | Count |", "|---|---|---|---|"); [...serverGroups.values()].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.hits - a.hits).forEach((g, i) => L.push(`| S${i + 1} | ${g.severity} | ${esc(g.text)} | ${g.hits} |`)); L.push(""); }

L.push("## 3. Database log (Postgres)", "");
if (!pgGroups.size) L.push("No errors or warnings.", "");
else { L.push("| # | Severity | Level | Message (normalised) | Count |", "|---|---|---|---|---|"); [...pgGroups.values()].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.hits - a.hits).forEach((g, i) => L.push(`| D${i + 1} | ${g.severity} | ${g.level} | ${esc(g.text)} | ${g.hits} |`)); L.push(""); }
if (importGroups.length) { L.push("### Import worker", "", "| Line | Count |", "|---|---|"); importGroups.forEach((g) => L.push(`| ${esc(g.text)} | ${g.hits} |`)); L.push(""); }

L.push("## 4. Slowest pages (p95)", "", "| Page | Loads | p50 | p95 | Max |", "|---|---|---|---|---|");
pages.slice(0, 25).forEach((p) => L.push(`| \`${p.url}\` | ${p.n} | ${(p.p50 / 1000).toFixed(2)} s | ${(p.p95 / 1000).toFixed(2)} s | ${(p.max / 1000).toFixed(2)} s |`));
const special = personas.flatMap((p) => p.timings.filter((t) => t.url.startsWith("[")));
if (special.length) {
  const burst = special.filter((t) => t.url.startsWith("[burst")).map((t) => t.ms), slow = special.filter((t) => t.url.startsWith("[3G]"));
  if (burst.length) L.push("", `Load burst (10 tabs × 4 heavy pages at once): median ${(pct(burst, 0.5) / 1000).toFixed(1)} s, p95 ${(pct(burst, 0.95) / 1000).toFixed(1)} s, slowest ${(Math.max(...burst) / 1000).toFixed(1)} s.`);
  if (slow.length) L.push("", `Throttled connection (400 ms latency, 200 KB/s): ${slow.map((t) => `${t.url.replace("[3G] /company/:id/", "")} ${(t.ms / 1000).toFixed(1)} s`).join(", ")}.`);
}
L.push("");

L.push("## 5. Personas and their journeys", "", "| Persona | Goal | Steps ok | Issues (crit/high/med/low) |", "|---|---|---|---|");
for (const p of personas) {
  const c = (s) => p.issues.filter((i) => i.severity === s).length;
  L.push(`| ${p.id} ${esc(p.name)} | ${esc(p.goal)} | ${p.steps.filter((s) => s.ok).length}/${p.steps.length} | ${c("critical")}/${c("high")}/${c("medium")}/${c("low")} |`);
}
L.push("", "### Failed or skipped steps", "");
for (const p of personas) for (const s of p.steps.filter((x) => !x.ok)) L.push(`- **${p.id}** ${esc(s.name)}: ${esc(s.error ?? "").slice(0, 250)}`);
L.push("", "## How to re-run", "", "```bash", "bash scripts/personas/run.sh            # fresh stack, build, 50 personas, this report", "SKIP_STACK=1 SKIP_BUILD=1 bash scripts/personas/run.sh -g P37   # one persona against what is running", "```", "");
L.push("Raw results: `test-results/personas/` (one JSON per persona, screenshots, server, database and import logs). They are not committed.");

fs.mkdirSync(path.dirname(DOC), { recursive: true });
fs.writeFileSync(DOC, L.join("\n") + "\n");
console.log(`${list.length} distinct issues (${count("critical")} critical, ${count("high")} high) → ${path.relative(ROOT, DOC)}`);

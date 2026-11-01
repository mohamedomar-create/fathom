/** The Data section's three tabs. Upload and Readiness open from Steps; Odoo live and End users sit under Connections. */
export type DataTabKey = "steps" | "checks" | "connections";
export interface DataTab { key: DataTabKey; href: string; active: boolean }

export function dataTabs(path: string, base: string, demo: boolean): DataTab[] {
  const rest = path.startsWith(base) ? path.slice(base.length) : "";
  const first = rest.split("/")[1] ?? "";
  const key: DataTabKey = first === "checks" ? "checks" : first === "odoo" || first === "end-users" ? "connections" : "steps";
  const tabs: DataTab[] = [
    { key: "steps", href: base, active: key === "steps" },
    { key: "checks", href: `${base}/checks`, active: key === "checks" },
    { key: "connections", href: `${base}/odoo`, active: key === "connections" },
  ];
  return demo ? tabs.filter((t) => t.key !== "connections") : tabs;
}

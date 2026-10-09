#!/usr/bin/env python3
"""Dump the reference Python engine's results for every month of sample.json (except the first,
which has no opening balance sheet). The TypeScript engine must reproduce these exactly.
Run: python3 -I tests/golden/make_golden.py reference/sample.json tests/golden/golden.json"""
import json, sys, os, importlib.util
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("br", os.path.join(here, "..", "..", "reference", "build_report.py"))
br = importlib.util.module_from_spec(spec); spec.loader.exec_module(br)

data = json.load(open(sys.argv[1]))
br.CUR = data.get("currency", "$")
months = sorted(data["months"], key=lambda m: m["period"])
tg = data.get("targets", {})
t = float(data.get("tax_rate", 0.25))
out = []
for idx in range(1, len(months)):
    period = months[idx]["period"]
    P = br.pl_calc(months[idx]["pl"]); B = br.bs_calc(months[idx]["bs"])
    B0 = br.bs_calc(months[idx - 1]["bs"]); Pprev = br.pl_calc(months[idx - 1]["pl"])
    W = br.cash_waterfall(P, B, B0, t)
    K = br.kpis(P, B, B0, Pprev, period, W["ocf"])
    status = {d[0]: br.kpi_status(K.get(d[0]), tg.get(d[0], d[5]), d[4], d[3])[0] for d in br.KPI_DEFS}
    Ps = [br.pl_calc(m["pl"]) for m in months[:idx + 1]]; Bs = [br.bs_calc(m["bs"]) for m in months[:idx + 1]]
    ctx = dict(P=P, B=B, Pprev=Pprev, K=K, W=W, tg=tg, Ps=Ps, Bs=Bs, idx=idx, days=br.days_in(period), status=status)
    found = br.insights(ctx)
    g = float(tg.get("profit_ratio", 10)) / 100; R = P["revenue"]; E = P["ebit"]; CM = R - P["variable_costs"]; gR = g * R
    need = lambda base, sign: None if not base else sign * (gR - E) / base * 100
    gs = {"price": (gR - E) / (R * (1 - g)) * 100, "volume": (gR - E) / (CM - gR) * 100,
          "cos_variable": need(P["cos_variable"], -1), "exp_fixed": need(P["exp_fixed"], -1),
          "exp_variable": need(P["exp_variable"], -1), "other_expenses": need(P["other_expenses"], -1),
          "other_income": need(P["other_income"], 1)}
    vcr = P["variable_costs"] / R; bep = P["fixed_costs"] / (1 - vcr)
    out.append({"period": period, "P": P, "B": B, "W": {k: W[k] for k in ("ocf", "fcf", "ncf", "dcash", "ddebt")},
                "rows": [[r[0], r[1], r[2]] for r in W["rows"]], "K": K, "status": status,
                "findings": found, "goalseek": gs, "bep": bep, "mos": R - bep})
json.dump(out, open(sys.argv[2], "w"), indent=1)
print(f"wrote {len(out)} months")

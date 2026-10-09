#!/usr/bin/env python3
"""Advisory-style management report builder.
Usage: python3 build_report.py data.json out.html
Input: monthly mapped P&L + BS (see SCHEMA in SKILL.md). Output: one self-contained HTML (A4-printable).
"""
import json, sys, math, html
from datetime import date
import calendar

PL_KEYS = ["revenue","cos_variable","cos_fixed","cos_depreciation","exp_variable","exp_fixed",
           "exp_depreciation","other_income","other_expenses","interest_income","interest_expenses",
           "tax_expenses","adjustments","dividends"]
BS_KEYS = ["cash","ar","inventory","wip","other_ca","fixed_assets","intangibles","investments",
           "std","ap","tax_liab","other_cl","ltd","other_ncl","retained_earnings","other_equity"]

# ---------------------------------------------------------------- formatting
CUR = "$"
def money(v, short=False):
    if v is None: return "–"
    neg = v < 0; a = abs(v)
    if short:
        s = f"{a/1e6:.1f}M" if a >= 1e6 else (f"{a/1e3:.0f}K" if a >= 1e3 else f"{a:.0f}")
    else:
        s = f"{a:,.0f}"
    return ("-" if neg else "") + f"{CUR} " + s
def pct(v, d=2):
    if v is None: return "–"
    if abs(v) < 0.5 * 10 ** -d: v = 0.0
    s = f"{v:,.{d}f}".rstrip("0").rstrip(".") if d else f"{v:,.0f}"
    return s + "%"
def num(v, unit):
    if v is None: return "–"
    if unit == "cur": return money(v)
    if unit == "%": return pct(v)
    if unit == "days": return f"{v:,.0f} days"
    if unit == "times": return f"{v:,.1f} times".replace(".0 times"," times")
    if unit == "ratio": return f"{v:,.2f}:1".replace(".00:1",":1")
    return f"{v:,.2f}"
def div(a, b):
    try:
        return None if a is None or b in (None, 0) else a / b
    except Exception: return None
def esc(s): return html.escape(str(s))
def mlabel(p):  # "2026-08" -> "Aug 2026"
    y, m = map(int, p.split("-")); return f"{calendar.month_abbr[m]} {y}"
def mshort(p):
    y, m = map(int, p.split("-")); return f"{calendar.month_abbr[m]} {str(y)[2:]}"
def days_in(p):
    y, m = map(int, p.split("-")); return calendar.monthrange(y, m)[1]

# ---------------------------------------------------------------- engine
def pl_calc(pl):
    g = {k: float(pl.get(k, 0) or 0) for k in PL_KEYS}
    r = dict(g)
    r["cos"] = g["cos_variable"] + g["cos_fixed"] + g["cos_depreciation"]
    r["expenses"] = g["exp_variable"] + g["exp_fixed"] + g["exp_depreciation"]
    r["gross_profit"] = g["revenue"] - r["cos"]
    r["operating_profit"] = r["gross_profit"] - r["expenses"]
    r["ebit"] = r["operating_profit"] + g["other_income"] - g["other_expenses"]
    r["ebt"] = r["ebit"] + g["interest_income"] - g["interest_expenses"]
    r["eat"] = r["ebt"] - g["tax_expenses"]
    r["net_income"] = r["eat"] - g["adjustments"]
    r["retained_income"] = r["net_income"] - g["dividends"]
    r["da"] = g["cos_depreciation"] + g["exp_depreciation"]
    r["ebitda"] = r["ebit"] + r["da"]
    r["net_interest"] = g["interest_expenses"] - g["interest_income"]
    r["variable_costs"] = g["cos_variable"] + g["exp_variable"]
    r["fixed_costs"] = g["cos_fixed"] + g["exp_fixed"] + r["da"]
    return r

def bs_calc(bs):
    b = {k: float(bs.get(k, 0) or 0) for k in BS_KEYS}
    r = dict(b)
    r["tca"] = b["cash"] + b["ar"] + b["inventory"] + b["wip"] + b["other_ca"]
    r["tnca"] = b["fixed_assets"] + b["intangibles"] + b["investments"]
    r["ta"] = r["tca"] + r["tnca"]
    r["tcl"] = b["std"] + b["ap"] + b["tax_liab"] + b["other_cl"]
    r["tncl"] = b["ltd"] + b["other_ncl"]
    r["tl"] = r["tcl"] + r["tncl"]
    r["te"] = b["retained_earnings"] + b["other_equity"]
    r["tle"] = r["tl"] + r["te"]
    r["imbalance"] = r["ta"] - r["tle"]
    r["debt"] = b["std"] + b["ltd"]
    r["owc"] = b["ar"] + b["inventory"] + b["wip"] - b["ap"]
    r["tic"] = r["te"] + r["debt"]
    r["toi"] = r["owc"] + b["fixed_assets"]
    return r

def cash_waterfall(P, B, B0, t):
    d = lambda k: B[k] - B0[k]
    cash_tax = P["tax_expenses"] - d("tax_liab") + t * P["net_interest"]
    rows = []
    def add(lbl, sign, v, tip=None): rows.append((lbl, sign, v))
    add("Revenue", "ADD", P["revenue"])
    add("Cost of Sales", "LESS", -(P["cos"] - P["cos_depreciation"]))
    add("Expenses", "LESS", -(P["expenses"] - P["exp_depreciation"] + P["other_expenses"]))
    add("Other Income", "ADD", P["other_income"])
    add("Cash Tax Paid", "LESS", -cash_tax)
    add("Change in Accounts Payable", "ADD", d("ap"))
    add("Change in Other Current Liabilities", "ADD", d("other_cl"))
    add("Change in Accounts Receivable", "LESS", -d("ar"))
    add("Change in Inventory", "LESS", -d("inventory"))
    add("Change in Work In Progress", "LESS", -d("wip"))
    add("Change in Other Current Assets", "LESS", -d("other_ca"))
    ocf = sum(r[2] for r in rows); rows.append(("OPERATING CASH FLOW", "TOTAL", ocf))
    inv = [("Change in Fixed Assets (ex. Depn & Amortisation)", "LESS", -(d("fixed_assets") + P["da"])),
           ("Change in Intangible Assets", "LESS", -d("intangibles")),
           ("Change in Investments or Other Non-Current Assets", "LESS", -d("investments"))]
    rows += inv; fcf = ocf + sum(r[2] for r in inv); rows.append(("FREE CASH FLOW", "TOTAL", fcf))
    eq_change = d("retained_earnings") + d("other_equity") - P["retained_income"]
    fin = [("Net Interest (after tax)", "LESS", -P["net_interest"] * (1 - t)),
           ("Change in Other Non-Current Liabilities", "ADD", d("other_ncl")),
           ("Dividends", "LESS", -P["dividends"]),
           ("Change in Retained Earnings and Other Equity", "ADD", eq_change)]
    rows += fin
    ncf_pre = fcf + sum(r[2] for r in fin)
    target = d("cash") - d("std") - d("ltd")
    unbal = target - ncf_pre + P["adjustments"]
    rows.append(("Change in unbalanced Balance Sheet", "ADD", unbal))
    rows.append(("Adjustments", "LESS", -P["adjustments"]))
    ncf = ncf_pre + unbal - P["adjustments"]
    rows.append(("NET CASH FLOW", "TOTAL", ncf))
    return {"rows": rows, "ocf": ocf, "fcf": fcf, "ncf": ncf, "dcash": d("cash"),
            "ddebt": d("std") + d("ltd"), "cash0": B0["cash"], "cash1": B["cash"],
            "debt0": B0["std"] + B0["ltd"], "debt1": B["std"] + B["ltd"]}

KPI_DEFS = [  # key, name, category, unit, direction, default target, importance
 ("total_revenue","Total Revenue","Profitability","cur","up",None,"Critical"),
 ("gpm","Gross Profit Margin","Profitability","%","up",35,"Medium"),
 ("opm","Operating Profit Margin","Profitability","%","up",15,"High"),
 ("profit_ratio","Profitability Ratio","Profitability","%","up",10,"Critical"),
 ("npat","Net Profit After Tax Margin","Profitability","%","up",7,"Medium"),
 ("activity","Activity Ratio","Activity","times","up",2,"Critical"),
 ("ar_days","Accounts Receivable Days","Activity","days","down",45,"Medium"),
 ("inv_days","Inventory Days","Activity","days","down",60,"Medium"),
 ("ap_days","Accounts Payable Days","Activity","days","up",45,"Medium"),
 ("roe","Return on Equity","Efficiency","%","up",15,"Critical"),
 ("roce","Return on Capital Employed","Efficiency","%","up",12.5,"Critical"),
 ("gmroi","Gross Margin Return on Inventory","Efficiency","%","up",150,"Low"),
 ("asset_turn","Asset Turnover","Asset Usage","times","up",2,"Medium"),
 ("wca","Working Capital Absorption","Asset Usage","%","down",25,"Low"),
 ("current","Current Ratio","Liquidity","ratio","up",2,"Medium"),
 ("quick","Quick Ratio","Liquidity","ratio","up",1,"Medium"),
 ("int_cover","Interest Cover","Coverage","times","up",3,"Medium"),
 ("cash","Cash on Hand","Cash Flow","cur","up",None,"Medium"),
 ("cf_margin","Cash Flow Margin","Cash Flow","%","up",10,"Low"),
 ("rev_growth","Revenue Growth","Growth","%","up",2,"Critical"),
 ("gp_growth","Gross Profit Growth","Growth","%","up",2,"Medium"),
 ("ebit_growth","EBIT Growth","Growth","%","up",2,"High"),
 ("asset_change","Asset Change","Growth","%","up",1,"Low"),
 ("equity_change","Equity Change","Growth","%","up",1,"Low"),
]
CAT_ORDER = ["Profitability","Activity","Efficiency","Asset Usage","Liquidity","Coverage","Cash Flow","Growth"]
CAT_COL = {"Profitability":"#3B7DD8","Activity":"#7B4FA0","Efficiency":"#2E9C8F","Asset Usage":"#C58A1B",
           "Liquidity":"#5A6ACF","Coverage":"#B5487A","Cash Flow":"#3E8E55","Growth":"#8A6D3B"}

def kpis(P, B, B0, Pprev, period, ocf):
    dd = days_in(period); ann = lambda x: x * 365 / dd
    k = {}
    k["total_revenue"] = P["revenue"]
    k["gpm"] = None if not P["revenue"] else P["gross_profit"] / P["revenue"] * 100
    k["opm"] = None if not P["revenue"] else P["operating_profit"] / P["revenue"] * 100
    k["profit_ratio"] = None if not P["revenue"] else P["ebit"] / P["revenue"] * 100
    k["npat"] = None if not P["revenue"] else P["eat"] / P["revenue"] * 100
    k["activity"] = div(ann(P["revenue"]), B["tic"])
    k["ar_days"] = div(B["ar"] * dd, P["revenue"])
    k["inv_days"] = div(B["inventory"] * dd, P["cos"])
    k["ap_days"] = div(B["ap"] * dd, P["cos"])
    k["roe"] = (lambda v: v * 100 if v is not None else None)(div(ann(P["net_income"]), B0["te"]))
    k["roce"] = (lambda v: v * 100 if v is not None else None)(div(ann(P["ebit"]), B["tic"]))
    avg_inv = (B["inventory"] + B0["inventory"]) / 2
    k["gmroi"] = (lambda v: v * 100 if v is not None else None)(div(ann(P["gross_profit"]), avg_inv))
    k["asset_turn"] = div(ann(P["revenue"]), B["ta"])
    k["wca"] = (lambda v: v * 100 if v is not None else None)(div(B["owc"], ann(P["revenue"])))
    k["current"] = div(B["tca"], B["tcl"])
    k["quick"] = div(B["cash"] + B["ar"], B["tcl"])
    k["int_cover"] = div(P["ebit"], P["net_interest"])
    k["cash"] = B["cash"]
    k["cf_margin"] = (lambda v: v * 100 if v is not None else None)(div(ocf, P["revenue"]))
    g = lambda a, b: None if b in (None, 0) else (a - b) / abs(b) * 100
    k["rev_growth"] = g(P["revenue"], Pprev["revenue"]) if Pprev else None
    k["gp_growth"] = g(P["gross_profit"], Pprev["gross_profit"]) if Pprev else None
    k["ebit_growth"] = g(P["ebit"], Pprev["ebit"]) if Pprev else None
    k["asset_change"] = g(B["ta"], B0["ta"])
    k["equity_change"] = g(B["te"], B0["te"])
    return k

def kpi_status(val, tgt, direction, unit):
    if val is None or tgt is None: return None, None
    ok = val >= tgt if direction == "up" else val <= tgt
    if unit == "cur": trend = (val - tgt) / abs(tgt) * 100 if tgt else None; tunit = "%"
    else: trend = val - tgt; tunit = unit
    return ok, (trend, tunit)

# ---------------------------------------------------------------- SVG helpers
def svg(w, h, body, cls=""):
    return f'<svg class="{cls}" viewBox="0 0 {w} {h}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">{body}</svg>'

def nice_ticks(lo, hi, n=6):
    if hi == lo: hi = lo + 1
    raw = (hi - lo) / n; mag = 10 ** math.floor(math.log10(abs(raw)))
    step = min([s * mag for s in (1, 2, 2.5, 5, 10) if s * mag >= raw])
    start = math.floor(lo / step) * step
    ticks = []; v = start
    while True:
        ticks.append(v)
        if v >= hi - step * 1e-9: break
        v += step
    return ticks

def line_chart(series, labels, w=900, h=300, target=None, marks=None, unit="cur"):
    """series: list of (name, values, colour, fill)"""
    pad_l, pad_r, pad_t, pad_b = 70, 20, 15, 34
    vals = [v for _, s, _, _ in series for v in s if v is not None] + ([target] if target is not None else [])
    lo, hi = min(vals + [0]), max(vals + [0])
    ticks = nice_ticks(lo, hi); lo, hi = ticks[0], ticks[-1]
    n = len(labels); X = lambda i: pad_l + (w - pad_l - pad_r) * (i / max(n - 1, 1))
    Y = lambda v: pad_t + (h - pad_t - pad_b) * (1 - (v - lo) / (hi - lo))
    b = []
    for t in ticks:
        lab = money(t, True) if unit == "cur" else pct(t, 0)
        b.append(f'<line x1="{pad_l}" x2="{w-pad_r}" y1="{Y(t):.1f}" y2="{Y(t):.1f}" class="grid"/>'
                 f'<text x="{pad_l-8}" y="{Y(t)+4:.1f}" class="ax" text-anchor="end">{lab}</text>')
    step = max(1, math.ceil(n / 12))
    for i, l in enumerate(labels):
        if i % step == 0 or i == n - 1:
            b.append(f'<text x="{X(i):.1f}" y="{h-10}" class="ax" text-anchor="middle">{esc(l)}</text>')
    if target is not None:
        b.append(f'<line x1="{pad_l}" x2="{w-pad_r}" y1="{Y(target):.1f}" y2="{Y(target):.1f}" class="target"/>')
    for name, s, col, fill in series:
        pts = [(X(i), Y(v)) for i, v in enumerate(s) if v is not None]
        if not pts: continue
        d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)
        if fill:
            b.append(f'<path d="{d} L{pts[-1][0]:.1f},{Y(max(lo,0)):.1f} L{pts[0][0]:.1f},{Y(max(lo,0)):.1f} Z" fill="{col}" opacity=".14"/>')
        b.append(f'<path d="{d}" fill="none" stroke="{col}" stroke-width="2.2" stroke-linejoin="round"/>')
        for x, y in pts: b.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3" fill="{col}"/>')
    if marks:
        for i, ok in enumerate(marks):
            if ok is None: continue
            b.append(f'<text x="{X(i):.1f}" y="{h-22}" text-anchor="middle" class="{"ok" if ok else "bad"}" font-size="11">{"✓" if ok else "✕"}</text>')
    return svg(w, h, "".join(b))

def breakeven_chart(rev, fixed, vcr, bep, w=520, h=440):
    xmax = max(rev, bep) * 1.45; ymax = max(xmax, fixed + vcr * xmax) * 1.05
    pl, pr, pt, pb = 64, 12, 12, 30
    X = lambda v: pl + (w - pl - pr) * v / xmax; Y = lambda v: pt + (h - pt - pb) * (1 - v / ymax)
    b = []
    for t in nice_ticks(0, ymax, 6):
        if t > ymax: continue
        b.append(f'<line x1="{pl}" x2="{w-pr}" y1="{Y(t):.1f}" y2="{Y(t):.1f}" class="grid"/><text x="{pl-6}" y="{Y(t)+4:.1f}" class="ax" text-anchor="end">{money(t,True)}</text>')
    for i in range(1, 20): b.append(f'<line y1="{pt}" y2="{h-pb}" x1="{X(xmax*i/20):.1f}" x2="{X(xmax*i/20):.1f}" class="grid"/>')
    b.append(f'<rect x="{pl}" y="{Y(fixed):.1f}" width="{w-pl-pr}" height="{Y(0)-Y(fixed):.1f}" fill="#000" opacity=".03"/>')
    lo, hi = sorted([bep, rev])
    poly = f"{X(lo):.1f},{Y(lo):.1f} {X(hi):.1f},{Y(hi):.1f} {X(hi):.1f},{Y(fixed+vcr*hi):.1f} {X(lo):.1f},{Y(fixed+vcr*lo):.1f}"
    b.append(f'<polygon points="{poly}" fill="{"#7CB46B" if rev>=bep else "#D9343A"}" opacity=".18"/>')
    def dline(x0, y0, x1, y1, col, n=22):
        s = f'<line x1="{X(x0):.1f}" y1="{Y(y0):.1f}" x2="{X(x1):.1f}" y2="{Y(y1):.1f}" stroke="{col}" stroke-width="2.2"/>'
        for i in range(n + 1):
            xv = x0 + (x1 - x0) * i / n; yv = y0 + (y1 - y0) * i / n
            s += f'<circle cx="{X(xv):.1f}" cy="{Y(yv):.1f}" r="2.6" fill="{col}"/>'
        return s
    b.append(dline(0, fixed, xmax, fixed, "#333"))
    b.append(dline(0, fixed, xmax, fixed + vcr * xmax, "#D9343A"))
    b.append(dline(0, 0, xmax, xmax, "#7CB46B"))
    b.append(f'<circle cx="{X(bep):.1f}" cy="{Y(bep):.1f}" r="6" fill="#fff" stroke="#333" stroke-width="3"/>')
    b.append(f'<circle cx="{X(rev):.1f}" cy="{Y(rev):.1f}" r="6" fill="#fff" stroke="#7CB46B" stroke-width="3"/>')
    b.append(f'<circle cx="{X(rev):.1f}" cy="{Y(fixed+vcr*rev):.1f}" r="6" fill="#fff" stroke="#D9343A" stroke-width="3"/>')
    def pill(x, y, txt, col): return f'<rect x="{x-len(txt)*3.9-10:.1f}" y="{y-11}" rx="11" width="{len(txt)*7.8+20:.1f}" height="22" fill="{col}"/><text x="{x:.1f}" y="{y+4}" text-anchor="middle" fill="#fff" font-size="11" letter-spacing=".5">{txt}</text>'
    b.append(pill(X(xmax * .62), Y(xmax * .62) - 22, "REVENUE", "#7CB46B"))
    b.append(pill(X(xmax * .75), Y(fixed + vcr * xmax * .75) + 26, "VARIABLE COSTS", "#D9343A"))
    b.append(pill(X(xmax * .8), Y(fixed) + 26, "FIXED COSTS", "#333"))
    return svg(w, h, "".join(b))

def waterfall(rows, w=900):
    rh = 26; h = rh * len(rows) + 40
    run = 0; spans = []
    for lbl, sign, v in rows:
        if sign == "TOTAL": spans.append((0, v)); run = v
        else: spans.append((run, run + v)); run += v
    allv = [x for s in spans for x in s] + [0]
    lo, hi = min(allv), max(allv); lo -= (hi - lo) * .05; hi += (hi - lo) * .05
    lx, rx = 430, w - 10; X = lambda v: lx + (rx - lx) * (v - lo) / (hi - lo)
    b = []
    for t in nice_ticks(lo, hi, 4):
        if lo <= t <= hi:
            b.append(f'<line x1="{X(t):.1f}" x2="{X(t):.1f}" y1="22" y2="{h-6}" class="grid"/><text x="{X(t):.1f}" y="14" class="ax" text-anchor="middle">{money(t,True)}</text>')
    for i, ((lbl, sign, v), (a, c)) in enumerate(zip(rows, spans)):
        y = 30 + i * rh
        if sign == "TOTAL":
            b.append(f'<line x1="0" x2="{w}" y1="{y-3}" y2="{y-3}" stroke="#222" stroke-width="1"/>')
            b.append(f'<text x="64" y="{y+14}" font-weight="700" font-size="12">{esc(lbl)}</text>')
            col = "#7CB46B" if v >= 0 else "#D9343A"
        else:
            b.append(f'<text x="0" y="{y+14}" class="sign">{sign}</text><text x="64" y="{y+14}" font-size="12">{esc(lbl)}</text>')
            col = "#7CB46B" if v >= 0 else "#D9343A"
        x0, x1 = sorted([X(a), X(c)])
        b.append(f'<rect x="{x0:.1f}" y="{y+2}" width="{max(x1-x0,1.5):.1f}" height="{rh-8}" fill="{col}" opacity="{1 if sign=="TOTAL" else .9}"/>')
        txt = money(v); tx = x1 + 6 if (x1 + 120) < rx else x0 - 6
        anchor = "start" if tx > x0 else "end"
        b.append(f'<text x="{tx:.1f}" y="{y+15}" font-size="11" text-anchor="{anchor}" class="{"ok" if v>=0 else "bad"}">{txt}</text>')
    return svg(w, h, "".join(b))

def growth_quadrant(pts, labels, w=760, h=460):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    x0, y0 = pts[0]
    xr = (max(xs) - min(xs)) or abs(x0) or 1; yr = (max(ys) - min(ys)) or abs(y0) or 1
    xlo, xhi = min(xs) - xr * .25, max(xs) + xr * .25; ylo, yhi = min(ys) - yr * .25, max(ys) + yr * .25
    pl, pr, pt, pb = 80, 20, 20, 50
    X = lambda v: pl + (w - pl - pr) * (v - xlo) / (xhi - xlo); Y = lambda v: pt + (h - pt - pb) * (1 - (v - ylo) / (yhi - ylo))
    b = [f'<rect x="{pl}" y="{pt}" width="{w-pl-pr}" height="{h-pt-pb}" fill="#FAFAF9" stroke="#EEE"/>',
         f'<line x1="{X(x0):.1f}" x2="{X(x0):.1f}" y1="{pt}" y2="{h-pb}" stroke="#CCC"/>',
         f'<line y1="{Y(y0):.1f}" y2="{Y(y0):.1f}" x1="{pl}" x2="{w-pr}" stroke="#CCC"/>']
    q = [("EFFICIENCY GAINS", (pl + X(x0)) / 2, (pt + Y(y0)) / 2), ("QUALITY GROWTH", (X(x0) + w - pr) / 2, (pt + Y(y0)) / 2),
         ("DECLINE", (pl + X(x0)) / 2, (Y(y0) + h - pb) / 2), ("STRESS", (X(x0) + w - pr) / 2, (Y(y0) + h - pb) / 2)]
    for t, x, y in q: b.append(f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="middle" class="quad">{t}</text>')
    d = "M" + " L".join(f"{X(a):.1f},{Y(c):.1f}" for a, c in pts)
    b.append(f'<path d="{d}" fill="none" stroke="#999" stroke-width="10" opacity=".18" stroke-linejoin="round" stroke-linecap="round"/>')
    for i, (a, c) in enumerate(pts):
        r = 9 if i == len(pts) - 1 else 5
        b.append(f'<circle cx="{X(a):.1f}" cy="{Y(c):.1f}" r="{r}" fill="#7CB46B"/>')
    b.append(f'<text x="{X(pts[-1][0]):.1f}" y="{Y(pts[-1][1])-14:.1f}" text-anchor="middle" class="ax">{esc(labels[-1])}</text>')
    b.append(f'<text x="{(pl+w-pr)/2}" y="{h-12}" text-anchor="middle" class="axt">TOTAL OPERATING INVESTMENT</text>')
    b.append(f'<text transform="translate(18,{(pt+h-pb)/2}) rotate(-90)" text-anchor="middle" class="axt">EARNINGS BEFORE INTEREST &amp; TAX</text>')
    for t in nice_ticks(xlo, xhi, 4):
        if xlo <= t <= xhi: b.append(f'<text x="{X(t):.1f}" y="{h-pb+16}" text-anchor="middle" class="ax">{money(t,True)}</text>')
    for t in nice_ticks(ylo, yhi, 4):
        if ylo <= t <= yhi: b.append(f'<text x="{pl-6}" y="{Y(t)+4:.1f}" text-anchor="end" class="ax">{money(t,True)}</text>')
    return svg(w, h, "".join(b))

def kpi_arc(items, pct_on, period, w=980, h=560):
    """items: list of (category, name, ok) with results only"""
    cx, cy, R = w / 2, h - 40, 290
    b = [f'<path d="M{cx-R-30},{cy} A{R+30},{R+30} 0 0 1 {cx+R+30},{cy}" fill="none" stroke="#F1F1EF" stroke-width="40"/>']
    n = len(items)
    if n:
        for i, (cat, name, ok) in enumerate(items):
            ang = math.pi - (i + 0.5) * math.pi / n
            x, y = cx + R * math.cos(ang), cy - R * math.sin(ang)
            rot = -math.degrees(ang) + 90
            col = "#7CB46B" if ok else "#D9343A"
            b.append(f'<g transform="translate({x:.1f},{y:.1f}) rotate({rot:.1f})"><rect x="-13" y="-13" width="26" height="26" fill="{col}"/>'
                     f'<text y="5" text-anchor="middle" fill="#fff" font-size="14" font-weight="700">{"○" if ok else "✕"}</text></g>')
            lx, ly = cx + (R + 24) * math.cos(ang), cy - (R + 24) * math.sin(ang)
            deg = math.degrees(ang)
            if deg <= 90: tr, anc = -deg, "start"
            else: tr, anc = 180 - deg, "end"
            nm = name if len(name) <= 26 else name[:25] + "…"
            b.append(f'<text transform="translate({lx:.1f},{ly:.1f}) rotate({tr:.1f})" dy="4" font-size="10.5" text-anchor="{anc}">{esc(nm)}</text>')
    b.append(f'<text x="{cx}" y="{cy-40}" text-anchor="middle" font-size="44">{pct_on:.0f}%</text>'
             f'<text x="{cx}" y="{cy-8}" text-anchor="middle" font-size="20" font-weight="600">{esc(period)}</text>'
             f'<text x="{cx}" y="{cy+16}" text-anchor="middle" class="ax">on track</text>')
    return svg(w, h, "".join(b))

def mini_pie(p):
    p = max(0, min(abs(p or 0), 100)) / 100
    if p >= .999: arc = '<circle cx="8" cy="8" r="7" fill="#7CB46B"/>'
    else:
        a = 2 * math.pi * p; x = 8 + 7 * math.sin(a); y = 8 - 7 * math.cos(a)
        arc = f'<path d="M8,8 L8,1 A7,7 0 {1 if p>.5 else 0} 1 {x:.2f},{y:.2f} Z" fill="#7CB46B"/>' if p > 0 else ""
    return f'<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#E7E7E3"/>{arc}</svg>'

# ---------------------------------------------------------------- page assembly
CSS = """
:root{--ink:#222;--mute:#7a7a75;--line:#E6E6E1;--band:#F5F5F3;--green:#7CB46B;--green-d:#5E9A4F;--red:#D9343A;--red-bg:#FCE7E7;--bar:#2D2D2D}
*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font:14px/1.45 "Poppins","Segoe UI",system-ui,sans-serif}
.top{background:var(--bar);color:#eee;padding:10px 28px;font-size:13px;display:flex;gap:22px;align-items:center;position:sticky;top:0;z-index:5}
.top b{color:#fff}.top a{color:#ccc;text-decoration:none}.top a:hover{color:#fff}
.wrap{max-width:1100px;margin:0 auto;padding:0 28px 60px}
.cover{text-align:center;padding:70px 0 50px;border-bottom:1px solid var(--line)}
.cover h1{font-weight:400;font-size:34px;margin:18px 0 8px}.cover .sub{color:var(--mute)}
.logo{height:56px}
section{page-break-before:always;padding-top:26px}section.first{page-break-before:auto}
.hdr{background:var(--band);margin:0 -28px 22px;padding:22px 28px;display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px}
.hdr h2{font-weight:400;font-size:30px;margin:0}.sent{color:var(--mute)}.sent b{color:var(--ink);font-weight:600;border-bottom:1px dashed #999}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-bottom:22px}
.tile{border-top:2px solid var(--line);padding-top:10px}.tile .l{font-size:11px;letter-spacing:.08em;color:var(--mute);text-transform:uppercase}
.tile .v{font-size:28px;margin-top:4px}.tile.neg .v{background:var(--red-bg);color:var(--red);padding:2px 8px}
.chips{display:flex;gap:8px;flex-wrap:wrap}.chip{background:#fff;border:1px solid var(--line);border-radius:4px;padding:3px 10px;font-size:12px}
.chip i{font-style:normal;display:inline-block;min-width:20px;text-align:center;border-radius:3px;margin-right:6px;padding:0 4px;background:#EEE}
.chip.ok i{background:#E3F1DE;color:var(--green-d)}.chip.bad i{background:var(--red-bg);color:var(--red)}
table{width:100%;border-collapse:collapse}th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);font-weight:600;text-align:right;padding:8px;border-bottom:1px solid var(--ink)}
th:first-child,td:first-child{text-align:left}td{padding:7px 8px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums}
tr.tot td{font-weight:700;border-top:1px solid var(--ink)}tr.cat td{font-weight:700;font-size:12px;letter-spacing:.06em;text-transform:uppercase;background:#fff;border-bottom:1px solid var(--ink);padding-top:16px}
.badge{display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;color:#fff;font-size:11px;border-radius:2px;margin-right:8px}
.ok{color:var(--green-d);fill:var(--green-d)}.bad{color:var(--red);fill:var(--red)}.mute{color:var(--mute)}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--red);margin-right:8px}
.grid{stroke:#EFEFEB;stroke-width:1}.ax{fill:#8a8a85;font-size:11px}.axt{fill:#999;font-size:11px;letter-spacing:.08em}
.target{stroke:#C9A0D8;stroke-dasharray:5 4;stroke-width:1.5}.quad{fill:#9a9a95;font-size:12px;letter-spacing:.08em}.sign{fill:#9a9a95;font-size:10px;letter-spacing:.06em}
.two{display:grid;grid-template-columns:1.25fr 1fr;gap:34px;align-items:start}
.side .blk{margin-bottom:20px}.side .l{font-size:11px;letter-spacing:.08em;color:var(--mute);text-transform:uppercase}.side .v{font-size:24px}
.side a{font-size:12px;color:var(--mute);border-bottom:1px dashed #aaa;text-decoration:none}
.legend{display:flex;gap:16px;font-size:12px;margin:6px 0 10px}.legend span:before{content:"";display:inline-block;width:10px;height:10px;margin-right:6px;background:var(--c)}
.note{font-size:12px;color:var(--mute);margin-top:10px}.banner{color:var(--red);font-size:13px}
.comment{background:var(--band);border-left:3px solid var(--green);padding:12px 16px;margin:18px 0;font-size:13px}
.gs-row{display:grid;grid-template-columns:150px 1fr 90px;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--line)}
.gs-bar{position:relative;height:12px;background:#F4F4F1}.gs-bar .z{position:absolute;left:50%;top:-4px;bottom:-4px;width:1px;background:#bbb}
.gs-bar .f{position:absolute;top:0;bottom:0;opacity:.55}.gs-h{font-size:11px;letter-spacing:.08em;color:var(--mute);text-align:center;margin:18px 0 4px}
.prog{display:flex;align-items:center;gap:10px;margin:8px 0 18px}.prog .track{flex:1;height:26px;background:repeating-linear-gradient(45deg,#f3f3f0,#f3f3f0 6px,#e9e9e5 6px,#e9e9e5 12px);border:1px solid var(--line);position:relative}
.prog .s,.prog .g{font-size:11px;font-weight:700;letter-spacing:.06em}
footer{margin-top:40px;font-size:11px;color:var(--mute);border-top:1px solid var(--line);padding-top:10px}
@media print{.top{display:none}.wrap{max-width:none}section{padding-top:0}@page{size:A4;margin:14mm}}
@media (max-width:760px){.tiles{grid-template-columns:1fr}.two{grid-template-columns:1fr}.hdr h2{font-size:24px}}
"""

def build(data):
    global CUR
    CUR = data.get("currency", "$")
    months = sorted(data["months"], key=lambda m: m["period"])
    period = data.get("period") or months[-1]["period"]
    idx = [m["period"] for m in months].index(period)
    t = float(data.get("tax_rate", 0.25))
    P = pl_calc(months[idx]["pl"]); B = bs_calc(months[idx]["bs"])
    B0 = bs_calc(months[idx - 1]["bs"]) if idx > 0 else B
    Pprev = pl_calc(months[idx - 1]["pl"]) if idx > 0 else None
    Pprev_label = mlabel(months[idx - 1]["period"]) if idx > 0 else "–"
    # YTD
    fy = int(data.get("fy_start_month", 1)); py, pm = map(int, period.split("-"))
    def in_fy(p):
        y, m = map(int, p.split("-")); fy_year = py if pm >= fy else py - 1
        start = fy_year * 12 + fy - 1; return start <= y * 12 + m - 1 <= py * 12 + pm - 1
    ytd = {k: sum(float(m["pl"].get(k, 0) or 0) for m in months if in_fy(m["period"])) for k in PL_KEYS}
    PY = pl_calc(ytd)
    W = cash_waterfall(P, B, B0, t)
    K = kpis(P, B, B0, Pprev, period, W["ocf"])
    tg = data.get("targets", {}); imp = data.get("importance", {})
    plab = mlabel(period); company = data.get("company", "Company")
    title = data.get("title", "Monthly Performance Report")
    comments = data.get("commentary", {})
    out = []
    out.append(f'<div class="top"><b>{esc(company)}</b>' + "".join(
        f'<a href="#{a}">{l}</a>' for a, l in [("kpis","KPIs"),("explorer","KPI Explorer"),("profit","Profitability"),("cash","Cash Flow"),("fin","Financials"),("trend","Trend"),("growth","Growth"),("goal","Goalseek")]) + '</div><div class="wrap">')
    logo = data.get("logo_data_uri")
    out.append(f'<div class="cover">{f"<img class=logo src={chr(34)}{logo}{chr(34)}>" if logo else ""}<h1>{esc(title)}</h1>'
               f'<div class="sub">{esc(company)} · <b class="sent" style="color:#222;border-bottom:1px dashed #999">{plab}</b></div>'
               f'<div class="note">Prepared {date.today():%d %b %Y}{" · " + esc(data.get("prepared_by")) if data.get("prepared_by") else ""}</div></div>')
    def comment(key):
        return f'<div class="comment">{esc(comments[key])}</div>' if comments.get(key) else ""
    # ---------------- KPIs
    rows = []; on = off = alerts = 0; arc_items = []; cats_seen = []
    letter = iter("ABCDEFGHIJ")
    for cat in CAT_ORDER:
        defs = [d for d in KPI_DEFS if d[2] == cat]
        L = next(letter)
        rows.append(f'<tr class="cat"><td><span class="badge" style="background:{CAT_COL[cat]}">{L}</span>{cat}</td><td>{plab if cat=="Profitability" else ""}</td><td colspan=2></td><td>{"vs TARGET" if cat=="Profitability" else ""}</td><td></td></tr>')
        for key, name, _, unit, direc, dt, di in defs:
            tgt = tg.get(key, dt); v = K.get(key)
            ok, tr = kpi_status(v, tgt, direc, unit)
            if ok is True: on += 1; arc_items.append((cat, name, True))
            elif ok is False: off += 1; arc_items.append((cat, name, False))
            star = "*" if direc == "down" else ""
            icon = "" if ok is None else (f'<span class="ok">✓</span>' if ok else f'<span class="bad">✕</span>')
            if tr and tr[0] is not None:
                tv, tu = tr; arrow = "▲" if tv > 0 else "▼"
                cls = "ok" if ok else "bad"
                ttxt = f'<span class="{cls}">{arrow}</span> ' + (pct(tv) if tu in ("%","cur") else (f"{tv:+.2f}" if tu == "ratio" else num(tv, tu)))
            else: ttxt = "–"
            rows.append(f'<tr><td>{name}{star}</td><td>{num(v, unit)}</td><td>{num(tgt, unit) if tgt is not None else "–"}</td><td>{icon}</td><td>{ttxt}</td><td>{imp.get(key, di)}</td></tr>')
    total = len(KPI_DEFS); na = total - on - off
    out.append(f'<section class="first" id="kpis"><div class="hdr"><h2>KPIs</h2><div class="sent">For the <b>Month</b> of <b>{plab}</b></div></div>'
               f'<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px"><div class="sent">Showing <b>{total} KPIs</b> comparing with <b>Target</b></div>'
               f'<div class="chips"><span class="chip"><i>{total}</i>All KPIs</span><span class="chip ok"><i>{on}</i>On track</span><span class="chip bad"><i>{off}</i>Off track</span></div></div>'
               f'<table><tr><th></th><th>Result</th><th>Target</th><th></th><th>Trend</th><th>Importance</th></tr>{"".join(rows)}</table>'
               f'<div class="note">* For this metric, a result below target is favourable. Trend for currency KPIs is % vs target; for % KPIs it is percentage points.</div>{comment("kpis")}</section>')
    # ---------------- Explorer
    pon = on / (on + off) * 100 if on + off else 0
    out.append(f'<section id="explorer"><div class="hdr"><h2>KPI Explorer</h2><div class="sent">For the <b>Month</b> of <b>{plab}</b></div></div>'
               f'{kpi_arc(arc_items, pon, plab)}<div class="note" style="text-align:center">{total} KPIs ({na} n/a results) · <span class="ok">{on} ON TRACK</span> · <span class="bad">{off} OFF TRACK</span></div></section>')
    # ---------------- Profitability
    vcr = div(P["variable_costs"], P["revenue"])
    if P["revenue"] and vcr is not None and vcr < 1:
        bep = P["fixed_costs"] / (1 - vcr); mos = P["revenue"] - bep
        body = (f'<div class="two"><div>{breakeven_chart(P["revenue"], P["fixed_costs"], vcr, bep)}</div><div class="side"><h3 style="font-weight:400;font-size:24px;margin:0 0 14px">Breakeven</h3>'
                f'<div class="blk"><div class="l"><span style="color:var(--green)">●</span> Revenue</div><div class="v">{money(P["revenue"])}</div></div>'
                f'<div class="blk"><div class="l"><span style="color:var(--red)">●</span> Total costs</div><div class="v">{money(P["cos"]+P["expenses"])}</div></div>'
                f'<div class="blk"><div class="l">● Breakeven point</div><div class="v">{money(bep)}</div></div>'
                f'<div class="blk"><div class="l">Margin of safety</div><div class="v {"bad" if mos<0 else ""}">{money(mos)}</div></div>'
                f'<div class="blk"><div class="l" style="color:var(--red)">— Variable costs</div><div>{CUR} {vcr:.2f} per {CUR} 1 of Revenue</div></div>'
                f'<div class="blk"><div class="l">— Fixed costs</div><div>{money(P["fixed_costs"])}</div></div></div></div>')
    else:
        body = '<div style="text-align:center;padding:60px"><div style="font-size:40px;color:#3B8FD0">ⓘ</div><h3>Sorry, the Profitability view can\'t be shown</h3><p class="mute">A breakeven point cannot be calculated when there is no revenue (or variable costs ≥ revenue).</p></div>'
    tile = lambda l, v: f'<div class="tile {"neg" if v<0 else ""}"><div class="l">{l}</div><div class="v">{money(v)}</div></div>'
    out.append(f'<section id="profit"><div class="hdr"><h2>Profitability</h2><div class="sent">For the <b>Month</b> of <b>{plab}</b></div></div>'
               f'<div class="tiles">{tile("Gross profit",P["gross_profit"])}{tile("Operating profit",P["operating_profit"])}{tile("EBIT",P["ebit"])}</div>{body}{comment("profitability")}</section>')
    # ---------------- Cash flow
    out.append(f'<section id="cash"><div class="hdr"><h2>Cash Flow</h2><div class="sent">For the <b>Month</b> of <b>{plab}</b></div></div>'
               f'<div class="tiles">{tile("Operating cash flow",W["ocf"])}{tile("Free cash flow",W["fcf"])}{tile("Net cash flow",W["ncf"])}</div>'
               f'<div class="legend"><span style="--c:#7CB46B">Cash Received</span><span style="--c:#D9343A">Cash Spent</span></div>{waterfall(W["rows"])}'
               f'<div class="note"><b>NET CASH FLOW CAN ALSO BE CALCULATED AS:</b> Change in Cash on Hand {money(W["dcash"])} (Open: {money(W["cash0"])}, Close: {money(W["cash1"])}) − Change in Debt {money(W["ddebt"])} (Open: {money(W["debt0"])}, Close: {money(W["debt1"])})</div>{comment("cashflow")}</section>')
    # ---------------- Financials
    def var(a, b, cost=False):
        if not b: return '<td class="mute">–</td>'
        v = (a - b) / abs(b) * 100; good = (v <= 0) if cost else (v >= 0)
        return f'<td class="{"ok" if good else "bad"}">{pct(v)}</td>'
    plrows = [("Revenue","revenue",0,0),("Cost of Sales","cos",0,1),("Gross Profit","gross_profit",1,0),("Expenses","expenses",0,1),
              ("Operating Profit","operating_profit",1,0),("Other Income","other_income",0,0),("Other Expenses","other_expenses",0,1),
              ("Earnings Before Interest & Tax","ebit",1,0),("Interest Income","interest_income",0,0),("Interest Expenses","interest_expenses",0,1),
              ("Earnings Before Tax","ebt",1,0),("Tax Expenses","tax_expenses",0,1),("Net Income","net_income",1,0)]
    pr = "".join(f'<tr class="{"tot" if tot else ""}"><td>{l}</td><td>{money(P[k])}</td><td>{money(Pprev[k]) if Pprev else "–"}</td>{var(P[k], Pprev[k] if Pprev else 0, cost)}'
                 f'<td>{mini_pie(div(P[k],P["revenue"])*100 if P["revenue"] else 0)} {pct(div(P[k],P["revenue"])*100,0) if P["revenue"] else "–"}</td><td>{money(PY[k])}</td></tr>' for l, k, tot, cost in plrows)
    bsrows = [("ASSETS",None,2),("Cash & Equivalents","cash",0),("Accounts Receivable","ar",0),("Inventory","inventory",0),("Work In Progress","wip",0),("Other Current Assets","other_ca",0),
              ("Total Current Assets","tca",1),("Fixed Assets","fixed_assets",0),("Intangible Assets","intangibles",0),("Investments / Other NCA","investments",0),("Total Non-Current Assets","tnca",1),("Total Assets","ta",1),
              ("LIABILITIES",None,2),("Short Term Debt","std",0),("Accounts Payable","ap",0),("Tax Liability","tax_liab",0),("Other Current Liabilities","other_cl",0),("Total Current Liabilities","tcl",1),
              ("Long Term Debt","ltd",0),("Other Non-Current Liabilities","other_ncl",0),("Total Non-Current Liabilities","tncl",1),("Total Liabilities","tl",1),
              ("EQUITY",None,2),("Retained Earnings","retained_earnings",0),("Other Equity","other_equity",0),("Total Equity","te",1),("Total Liabilities & Equity","tle",1)]
    br = ""
    for l, k, typ in bsrows:
        if typ == 2: br += f'<tr class="cat"><td colspan=6>{l}</td></tr>'; continue
        if typ == 0 and not B[k] and not B0[k]: continue
        dv = B[k] - B0[k]
        br += (f'<tr class="{"tot" if typ else ""}"><td>{l}</td><td>{money(B[k])}</td><td>{money(B0[k])}</td><td class="{"ok" if dv>=0 else "bad"}">{money(dv)}</td>'
               f'{var(B[k],B0[k])}<td>{mini_pie(div(B[k],B["ta"])*100 if B["ta"] else 0)} {pct(div(B[k],B["ta"])*100,0) if B["ta"] else "–"}</td></tr>')
    banner = f'<span class="banner">Out of balance by {money(B["imbalance"])}</span>' if abs(B["imbalance"]) > 0.5 else ""
    out.append(f'<section id="fin"><div class="hdr"><h2>Financials</h2><div class="sent">View <b>Profit &amp; Loss</b> compared with <b>Last month</b> · For the <b>Month</b> of <b>{plab}</b></div></div>'
               f'<table><tr><th>Profit &amp; Loss</th><th>{plab}</th><th>{Pprev_label}</th><th>Variance %</th><th>Common Size</th><th>YTD</th></tr>{pr}</table>{comment("pl")}'
               f'<div style="display:flex;justify-content:space-between;margin-top:34px"><h3 style="font-weight:400;margin:0">Balance Sheet</h3>{banner}</div>'
               f'<table><tr><th>Balance Sheet</th><th>{plab}</th><th>{Pprev_label}</th><th>Variance {esc(CUR)}</th><th>Variance %</th><th>Common Size</th></tr>{br}</table>{comment("bs")}</section>')
    # ---------------- Trend
    labs = [mshort(m["period"]) for m in months[:idx + 1]]
    Ps = [pl_calc(m["pl"]) for m in months[:idx + 1]]
    Bs = [bs_calc(m["bs"]) for m in months[:idx + 1]]
    trend1 = line_chart([("Revenue", [p["revenue"] for p in Ps], "#3B8FD0", False)], labs)
    trend2 = line_chart([("Gross Profit", [p["gross_profit"] for p in Ps], "#7CB46B", True), ("EBIT", [p["ebit"] for p in Ps], "#D9343A", False)], labs)
    trend3 = line_chart([("Cash", [b["cash"] for b in Bs], "#2E9C8F", True)], labs)
    gpm_series = [p["gross_profit"] / p["revenue"] * 100 if p["revenue"] else None for p in Ps]
    gt = tg.get("gpm", 35)
    gmarks = [None if v is None else v >= gt for v in gpm_series]
    trend4 = line_chart([("Gross Profit Margin", gpm_series, "#7B4FA0", False)], labs, target=gt, marks=gmarks, unit="%")
    out.append(f'<section id="trend"><div class="hdr"><h2>Trend</h2><div class="sent">Up to the <b>Month</b> of <b>{plab}</b></div></div>'
               f'<div class="sent">Showing <b>Revenue</b></div>{trend1}<div class="sent" style="margin-top:18px">Showing <b>Gross Profit</b> + <b>EBIT</b></div>'
               f'<div class="legend"><span style="--c:#7CB46B">Gross Profit</span><span style="--c:#D9343A">EBIT</span></div>{trend2}'
               f'<div class="sent" style="margin-top:18px">Showing <b>Gross Profit Margin</b> vs target {pct(gt)}</div>{trend4}'
               f'<div class="sent" style="margin-top:18px">Showing <b>Cash on Hand</b></div>{trend3}{comment("trend")}</section>')
    # ---------------- Growth
    start = max(0, idx - 12)
    gp = [(bs_calc(m["bs"])["toi"], pl_calc(m["pl"])["ebit"]) for m in months[start:idx + 1]]
    glab = [mlabel(m["period"]) for m in months[start:idx + 1]]
    out.append(f'<section id="growth"><div class="hdr"><h2>Growth</h2><div class="sent">Up to the <b>Month</b> of <b>{plab}</b> · Comparing <b>EBIT vs Total Operating Investment</b> from <b>{glab[0]}</b></div></div>'
               f'{growth_quadrant(gp, glab) if len(gp) > 1 else "<p class=mute>Needs at least 2 months.</p>"}{comment("growth")}</section>')
    # ---------------- Goalseek
    g = float(tg.get("profit_ratio", 10)) / 100; R = P["revenue"]; E = P["ebit"]; CM = R - P["variable_costs"]; gR = g * R
    def need(base, sign):
        return None if not base else sign * (gR - E) / base * 100
    levers = []
    if R:
        levers = [("HIGH SENSITIVITY", [("Price", (gR - E) / (R * (1 - g)) * 100 if g < 1 else None, "#3B8FD0"),
                                        ("Volume", (gR - E) / (CM - gR) * 100 if CM - gR else None, "#B06AB3"),
                                        ("Variable COS", need(P["cos_variable"], -1), "#2E9C8F"),
                                        ("Fixed Expenses", need(P["exp_fixed"], -1), "#7CB46B")]),
                  ("MEDIUM SENSITIVITY", [("Variable Expenses", need(P["exp_variable"], -1), "#C58A1B"),
                                          ("Other Expenses", need(P["other_expenses"], -1), "#B5487A")]),
                  ("LOW SENSITIVITY", [("Other Income", need(P["other_income"], 1), "#5A6ACF")])]
    gs = ""
    for band, items in levers:
        lim = max([abs(v) for _, v, _ in items if v is not None] + [10]) * 1.15
        gs += f'<div class="gs-h">{band} (axis ±{lim:,.0f}%)</div>'
        for name, v, col in items:
            if v is None: bar = ""; lab = "–"
            else:
                w_ = min(abs(v) / lim * 50, 50); left = 50 if v >= 0 else 50 - w_
                bar = f'<div class="f" style="left:{left}%;width:{w_}%;background:{col}"></div>'; lab = pct(v)
            gs += f'<div class="gs-row"><div>{name}</div><div class="gs-bar"><div class="z"></div>{bar}</div><div style="text-align:right">{lab}</div></div>'
    cur_ratio = E / R * 100 if R else 0
    out.append(f'<section id="goal"><div class="hdr"><h2>Goalseek</h2><div class="sent">For the <b>Month</b> of <b>{plab}</b></div></div>'
               f'<div class="sent">Changes required to increase <b>Profitability Ratio</b> from {pct(cur_ratio)} to <b>{pct(g*100)}</b></div>'
               f'<div class="prog"><span class="s">START {pct(cur_ratio)}</span><div class="track"></div><span class="g">GOAL {pct(g*100)}</span></div>' +
               (f'<div class="comment">Goal already reached — negative bars show how far each item could move before the ratio falls back to the goal.</div>' if R and cur_ratio >= g*100 else '') + f'<div class="note">Each bar = the % change in that one item alone that would reach the goal (others unchanged).</div>{gs}{comment("goalseek")}</section>')
    disc = data.get("disclaimer", "This report has been prepared from unaudited financial information provided by management. No opinion is expressed on its accuracy.")
    out.append(f'<footer>{esc(company)} ({plab}){" - Prepared by " + esc(data["prepared_by"]) if data.get("prepared_by") else ""} · {esc(disc)}</footer></div>')
    checks = {"bs_imbalance": B["imbalance"], "ncf_check": W["ncf"] - (W["dcash"] - W["ddebt"]),
              "on_track": on, "off_track": off, "na": na}
    page = f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{esc(title)}</title><style>{CSS}</style></head><body>{"".join(out)}</body></html>'
    return page, checks

if __name__ == "__main__":
    data = json.load(open(sys.argv[1]))
    page, checks = build(data)
    open(sys.argv[2], "w").write(page)
    print(json.dumps(checks, indent=1))

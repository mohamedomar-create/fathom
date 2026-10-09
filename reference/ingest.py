#!/usr/bin/env python3
"""Turn a messy financial file (xlsx / xls / csv) into the clean monthly JSON that build_report.py reads.

Usage:
  python3 ingest.py INPUT [INPUT2 ...] --company "Name" --currency EGP --out data.json
        [--sheet NAME]... [--map mapping.csv] [--fy-start 1] [--tax-rate 0.225]
        [--ytd auto|yes|no] [--close-earnings] [--plug-equity] [--outdir DIR]

Writes:  data.json            clean input for build_report.py
         mapping_review.csv   every source line -> class, confidence (edit and re-run with --map)
         ingest_report.md     what was skipped, flipped, unmapped, unbalanced (read this before trusting the numbers)

Design rule: never silently guess. Every judgement call (sign flip, de-accumulation, skipped subtotal,
plug) is written to ingest_report.md and to data["notes"], which prints on the report's last page.
"""
import argparse, calendar, csv, json, os, re, sys
from collections import defaultdict, OrderedDict
from datetime import datetime, date

import pandas as pd

PL_KEYS = ["revenue", "cos_variable", "cos_fixed", "cos_depreciation", "exp_variable", "exp_fixed",
           "exp_depreciation", "other_income", "other_expenses", "interest_income", "interest_expenses",
           "tax_expenses", "adjustments", "dividends"]
BS_KEYS = ["cash", "ar", "inventory", "wip", "other_ca", "fixed_assets", "intangibles", "investments",
           "std", "ap", "tax_liab", "other_cl", "ltd", "other_ncl", "retained_earnings", "other_equity"]
CREDIT = {"revenue", "other_income", "interest_income", "std", "ap", "tax_liab", "other_cl", "ltd", "other_ncl",
          "retained_earnings", "other_equity"}
COSTS = {"cos_variable", "cos_fixed", "cos_depreciation", "exp_variable", "exp_fixed", "exp_depreciation",
         "other_expenses", "interest_expenses", "tax_expenses", "adjustments", "dividends"}

# ------------------------------------------------------------------ classification rules
# (class, regex). Order matters: specific before generic. Arabic terms included for Egyptian / GCC files.
PL_RULES = [
    ("interest_income", r"interest (income|received|earned)|إيراد(ات)? فوائد|فوائد دائنة|interest on deposits"),
    ("interest_expenses", r"interest (expense|paid|charge|on (loan|overdraft|borrowing))|finance (cost|charge|expense)|loan interest|فوائد مدينة|مصروفات تمويلية|مصاريف تمويلية|فوائد قروض"),
    ("tax_expenses", r"(income|corporate|company|profit) tax|tax expense|provision for (income )?tax|ضريبة (الدخل|الشركات|أرباح)|ضرائب الدخل"),
    ("dividends", r"dividend|distribution(s)? to|توزيعات"),
    ("adjustments", r"adjustment|prior.?period|extraordinary|تسويات|فروقات سنوات"),
    ("other_income", r"other (operating )?income|gain on|sundry income|miscellaneous income|fx gain|(foreign )?exchange gain|rental income|إيرادات (أخرى|اخرى|متنوعة)|ايرادات اخرى|أرباح بيع أصول"),
    ("other_expenses", r"other (operating )?expense|loss on|fx loss|(foreign )?exchange loss|write.?off|impairment|bad debt|مصروفات (أخرى|اخرى)|مصاريف اخرى|خسائر"),
    ("cos", r"cost of (sales|goods|revenue|services|sold)|cogs|purchases?|direct (cost|material|labou?r)|raw material|freight.?in|inventory (adjustment|write)|production cost|تكلفة (المبيعات|البضاعة|الخدمات|المبيعات)|مشتريات|مواد خام"),
    ("revenue", r"sales|revenue|turnover|fees? (earned|income)|service (income|fees)|income from|subscription|مبيعات|إيراد(ات)?|ايرادات|دخل"),
]
DEPRECIATION = r"depreciation|amorti[sz]ation|إهلاك|اهلاك|استهلاك"
CONTRA_REVENUE = r"returns?|discounts? (allowed|given)|allowances?|rebates?|مردودات|خصم مسموح"
VARIABLE_HINT = r"commission|freight|shipping|delivery|packag|merchant|payment (gateway|processing)|transaction (fee|cost)|credit card (fee|charge)|bank (charge|fee)|fuel|royalt|raw material|materials?|purchases?|consumables?|cogs|sales (tax|incentive)|عمولة|شحن|توصيل|تغليف|رسوم بنكية|مشتريات|مواد"
FIXED_COS_HINT = r"salar|wage|labou?r|payroll|rent|insurance|rental|رواتب|أجور|اجور|إيجار|ايجار"
BS_RULES = [
    ("tax_liab", r"(vat|sales tax|income tax|corporate tax|payroll tax|withholding|gst|social insurance|tax(es)?)( \w+)? (payable|liabilit|due|control)|tax payable|ضريبة القيمة المضافة|ضرائب (مستحقة|دائنة)|تأمينات اجتماعية|مصلحة الضرائب"),
    ("std", r"overdraft|short.?term (loan|debt|borrowing|facilit)|current (portion|maturit)|credit card (payable|liab)|line of credit|(bank|loans?) payable|قروض قصيرة|سحب على المكشوف|بنوك دائنة|تسهيلات"),
    ("ltd", r"long.?term (loan|debt|borrowing|liabilit)|mortgage|bonds? payable|term loan|notes payable.*long|قروض طويلة"),
    ("other_ncl", r"deferred tax|lease liabilit|non.?current (liabilit|provision)|end of service|severance|مكافأة نهاية|التزامات طويلة"),
    ("other_cl", r"accrued|accruals?|deferred (revenue|income)|unearned|customer (deposit|advance)|advances? from|provision|salaries payable|wages payable|due to|other (current )?liabilit|مستحق(ات)?|مصروفات مستحقة|إيرادات مقدمة|مخصص|دائنون متنوعون|أرصدة دائنة"),
    ("ap", r"payables?|creditors?|suppliers?|vendors?|موردين|موردون|دائنون|أوراق دفع"),
    ("retained_earnings", r"retained|accumulated (earnings|profit|loss)|(current|this) (year|period).*(earnings|profit|income)|net (profit|income|loss) (for|ytd|of)|profit (for|of) the (year|period)|أرباح (محتجزة|مرحلة|العام|السنة)|الأرباح المرحلة|نتيجة العام"),
    ("other_equity", r"capital|share (premium|capital)|equity|reserves?|owner|partner|paid.?in|treasury shares|رأس المال|احتياطي|جاري الشركاء|حقوق (الملكية|المساهمين)"),
    ("wip", r"work.?in.?(progress|process)|\bwip\b|عقود تحت التنفيذ|إنتاج تحت التشغيل"),
    ("inventory", r"inventor|stock|finished goods|merchandise|goods (on hand|for resale)|مخزون|بضاعة"),
    ("ar", r"receivables?|debtors?|customers?|notes receivable|عملاء|مدينون|أوراق قبض"),
    ("other_ca", r"prepaid|prepayment|advance|deposits? (paid|with)|other (current )?assets?|accrued income|due from|input vat|vat receivable|مصروفات مقدمة|دفعات مقدمة|سلف|تأمينات لدى|أرصدة مدينة|عهد"),
    ("intangibles", r"intangible|goodwill|patent|trademark|software|licen[cs]e|development cost|شهرة|برمجيات|علامة تجارية"),
    ("investments", r"investments?|long.?term (deposit|receivable)|loans? to|استثمارات"),
    ("fixed_assets", r"property|plant|equipment|furniture|vehicles?|machinery|buildings?|land|fixed assets?|accumulated depreciation|leasehold|computers?|fit.?out|أصول ثابتة|معدات|سيارات|مباني|أراضي|مجمع (إهلاك|اهلاك)|آلات|أثاث"),
    ("cash", r"cash|bank|petty|treasury|safe|نقدية|نقدي|بنك|خزينة|حساب جاري لدى"),
]
ALWAYS_PL_FIRST = r"bank (charge|fee)s?|cash (discount|short)"
SUBTOTAL = re.compile(r"^\s*(total|sub.?total|grand total|gross (profit|margin|loss)|net (income|profit|loss|earnings|sales)|operating (profit|income|loss)|ebit(da)?\b|"
                      r"profit (before|after)|(income|earnings) before|working capital|check|difference|balance check|"
                      r"الإجمالي|اجمالي|إجمالي|مجموع|صافي (الربح|الدخل|الخسارة)|مجمل (الربح|الخسارة))", re.I)
BS_HEADINGS = r"asset|liabilit|equity|capital|shareholder|owner|الأصول|الاصول|الخصوم|الالتزامات|حقوق"
PL_HEADINGS = r"income|revenue|sales|expense|cost|turnover|profit|الإيرادات|المصروفات|المصاريف|تكلفة|الدخل"
BUDGET_WORDS = re.compile(r"budget|forecast|\bplan\b|\btarget|variance|\bvar\b|%|\bprior|last year|\b(py|ly)\b|\bdiff|موازنة|تقديري|مخطط", re.I)

MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_abbr) if m}
MONTHS.update({m.lower(): i for i, m in enumerate(calendar.month_name) if m})
AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩٫٬", "0123456789.,")


# ------------------------------------------------------------------ cleaning helpers
def clean_num(v):
    """'(1,234.5)' -> -1234.5 ; '1.234,50-' handled ; '-' / '' -> 0 ; text -> None."""
    if v is None or (isinstance(v, float) and pd.isna(v)): return None
    if isinstance(v, (int, float)): return float(v)
    if isinstance(v, (datetime, date, pd.Timestamp)): return None
    s = str(v).strip().translate(AR_DIGITS)
    if s in ("", "-", "–", "—", "nil", "Nil", "NIL"): return 0.0
    neg = False
    if s.startswith("(") and s.endswith(")"): neg, s = True, s[1:-1]
    if s.endswith("-"): neg, s = True, s[:-1]
    if s.startswith("-"): neg, s = (not neg), s[1:]
    s = re.sub(r"[^\d.,]", "", s)
    if not s or not re.search(r"\d", s): return None
    if "," in s and "." in s:
        s = s.replace(",", "") if s.rfind(".") > s.rfind(",") else s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", "") if re.fullmatch(r"\d{1,3}(,\d{3})+", s) else s.replace(",", ".")
    try: x = float(s)
    except ValueError: return None
    return -x if neg else x


def parse_period(v):
    """Cell -> 'YYYY-MM' or None. Accepts dates, 'Jan-25', 'January 2025', '2025-01', '01/2025', '31/01/2025'."""
    if v is None or (isinstance(v, float) and pd.isna(v)): return None
    if isinstance(v, (datetime, date, pd.Timestamp)): return f"{v.year:04d}-{v.month:02d}"
    s = str(v).strip().translate(AR_DIGITS)
    if not s: return None
    m = re.fullmatch(r"(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?(?: 00:00:00)?", s)
    if m and 1 <= int(m.group(2)) <= 12: return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}"
    m = re.fullmatch(r"(\d{1,2})[-/.](\d{4})", s)
    if m and 1 <= int(m.group(1)) <= 12: return f"{int(m.group(2)):04d}-{int(m.group(1)):02d}"
    m = re.fullmatch(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})", s)
    if m:
        a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3)); y += 2000 if y < 100 else 0
        if a > 12 and 1 <= b <= 12: return f"{y:04d}-{b:02d}"          # dd/mm/yyyy
        if b > 12 and 1 <= a <= 12: return f"{y:04d}-{a:02d}"          # mm/dd/yyyy
        if 1 <= b <= 12: return f"{y:04d}-{b:02d}"                      # ambiguous: assume dd/mm (Egypt/EU); reported as note
    m = re.fullmatch(r"([A-Za-z]{3,9})[\s\-_/.,']*(\d{2,4})", s)
    if m and m.group(1).lower() in MONTHS:
        y = int(m.group(2)); y += 2000 if y < 100 else 0
        return f"{y:04d}-{MONTHS[m.group(1).lower()]:02d}"
    m = re.fullmatch(r"(\d{2,4})[\s\-_/.,']*([A-Za-z]{3,9})", s)
    if m and m.group(2).lower() in MONTHS:
        y = int(m.group(1)); y += 2000 if y < 100 else 0
        return f"{y:04d}-{MONTHS[m.group(2).lower()]:02d}"
    return None


def norm_label(s): return re.sub(r"\s+", " ", re.sub(r"^[\d\.\-\s:]+", "", str(s))).strip().lower()


def stmt_from_text(t):
    t = (t or "").lower()
    if re.search(r"balance|position|financial position|\bbs\b|ميزانية|المركز المالي", t): return "BS"
    if re.search(r"p&l|p & l|\bpl\b|profit|income|loss|operations|earnings|قائمة الدخل|الأرباح", t) and "balance" not in t: return "PL"
    return None


def classify(label, section, stmt, mapping):
    """-> (class | None, confidence, note). class is a PL/BS key; 'cos'/'expenses' resolved to *_variable/_fixed/_depreciation."""
    key = norm_label(label)
    if key in mapping: return mapping[key], 1.0, "mapping file"
    low = label.lower(); sec = (section or "").lower()
    dep = re.search(DEPRECIATION, low)
    in_cos = re.search(r"cost of|cogs|direct|تكلفة", sec)
    in_exp = re.search(r"expense|overhead|مصروفات|مصاريف|opex|operating cost", sec)
    in_rev = re.search(r"revenue|sales|income|إيرادات|ايرادات", sec) and not in_cos and not in_exp
    st = stmt
    if st is None:
        if re.search(BS_HEADINGS, sec): st = "BS"
        elif re.search(PL_HEADINGS, sec): st = "PL"
    if re.search(ALWAYS_PL_FIRST, low): st = "PL"
    if st in (None, "PL"):
        if dep and (st == "PL" or in_cos or in_exp or not re.search(r"accumulated|مجمع", low)):
            return ("cos_depreciation" if in_cos else "exp_depreciation"), 0.9, "depreciation"
        for cls, rx in PL_RULES:
            if re.search(rx, low):
                if cls == "cos": return ("cos_fixed" if re.search(FIXED_COS_HINT, low) else "cos_variable"), 0.85, "cost of sales"
                if cls == "revenue" and (in_cos or in_exp or re.search(r"commission|marketing|expense|salar|staff|\btax|cost|عمولة", low)): continue
                return cls, 0.9, "keyword"
        if st is None and re.search(r"expenses?\b|مصروفات|مصاريف|overheads?", low):
            return ("exp_variable" if re.search(VARIABLE_HINT, low) else "exp_fixed"), 0.5, "expense wording (check)"
        if st == "PL" or in_cos or in_exp or in_rev:
            if in_rev: return "revenue", 0.6, "section heading"
            if in_cos: return ("cos_fixed" if re.search(FIXED_COS_HINT, low) else "cos_variable"), 0.6, "section heading"
            return ("exp_variable" if re.search(VARIABLE_HINT, low) else "exp_fixed"), 0.6 if in_exp else 0.45, "default expense"
    if st in (None, "BS"):
        for cls, rx in BS_RULES:
            if re.search(rx, low): return cls, 0.9 if st == "BS" else 0.75, "keyword"
        if st == "BS":
            if re.search(r"asset|الأصول", sec): return "other_ca", 0.4, "section heading (check)"
            if re.search(r"liabilit|الخصوم|الالتزامات", sec): return "other_cl", 0.4, "section heading (check)"
            if re.search(r"equity|capital|حقوق", sec): return "other_equity", 0.4, "section heading (check)"
    return None, 0.0, "no rule matched"


# ------------------------------------------------------------------ reading
def read_grids(path, sheets):
    ext = os.path.splitext(path)[1].lower()
    if ext in (".csv", ".txt", ".tsv"):
        for enc in ("utf-8-sig", "cp1256", "latin-1"):
            try:
                df = pd.read_csv(path, header=None, sep=None, engine="python", encoding=enc, dtype=object, skip_blank_lines=False)
                return {os.path.basename(path): df}
            except Exception: continue
        raise SystemExit(f"Cannot read {path}")
    xl = pd.ExcelFile(path)
    names = [s for s in xl.sheet_names if not sheets or s in sheets]
    return {n: xl.parse(n, header=None, dtype=object) for n in names}


def find_header(df):
    """Row index with >=3 period-like cells -> (row, {col: period})."""
    best = None
    for r in range(min(len(df), 40)):
        cols = {}
        for c in range(df.shape[1]):
            p = parse_period(df.iat[r, c])
            if p: cols[c] = p
        if len(cols) >= 3 and (best is None or len(cols) > len(best[1])): best = (r, cols)
    return best


def extract_wide(name, df, hdr_row, pcols, stmt_hint, issues):
    # drop budget/variance columns using header text and the two rows above
    keep = {}
    for c, p in pcols.items():
        ctx = " ".join(str(df.iat[r, c]) for r in range(max(0, hdr_row - 2), hdr_row + 1) if not pd.isna(df.iat[r, c]) and parse_period(df.iat[r, c]) is None)
        if BUDGET_WORDS.search(ctx) or BUDGET_WORDS.search(str(df.iat[hdr_row, c])):
            issues["skipped_cols"].append(f"{name}: column {c} ({p}) looks like budget/variance: '{ctx.strip()}'"); continue
        if p in keep.values():
            issues["skipped_cols"].append(f"{name}: duplicate column for {p} ignored (first one kept)"); continue
        keep[c] = p
    label_col = min(c for c in range(df.shape[1]) if c < min(keep)) if min(keep) > 0 else None
    if label_col is None: raise SystemExit(f"{name}: no label column left of the period columns")
    # label column = leftmost column with most text
    text_counts = {c: sum(isinstance(df.iat[r, c], str) for r in range(hdr_row + 1, len(df))) for c in range(min(keep))}
    label_col = max(text_counts, key=text_counts.get)
    rows, section = [], ""
    for r in range(hdr_row + 1, len(df)):
        lab = df.iat[r, label_col]
        if lab is None or (isinstance(lab, float) and pd.isna(lab)): continue
        lab = str(lab).strip()
        if not lab or re.fullmatch(r"[\d\.\-\s]+", lab): continue
        vals = {p: clean_num(df.iat[r, c]) for c, p in keep.items()}
        nums = [v for v in vals.values() if v is not None]
        if not nums:
            section = lab; continue                                   # heading row
        rows.append(dict(sheet=name, label=lab, section=section, stmt=stmt_hint, vals=vals, row=r + 1))
    return rows


def extract_long(name, df, stmt_hint, issues):
    """Header row with account/date/amount-like names."""
    for r in range(min(len(df), 15)):
        cells = [str(x).strip().lower() if not pd.isna(x) else "" for x in df.iloc[r]]
        acc = [i for i, x in enumerate(cells) if re.search(r"account|description|name|اسم|بيان|حساب", x)]
        dat = [i for i, x in enumerate(cells) if re.search(r"date|period|month|تاريخ|شهر|فترة", x)]
        amt = [i for i, x in enumerate(cells) if re.search(r"amount|balance|value|net|مبلغ|رصيد|قيمة", x)]
        deb = [i for i, x in enumerate(cells) if re.search(r"debit|مدين", x)]
        cre = [i for i, x in enumerate(cells) if re.search(r"credit|دائن", x)]
        if acc and dat and (amt or (deb and cre)):
            typ = [i for i, x in enumerate(cells) if re.search(r"type|class|category|statement|نوع|تصنيف", x)]
            out = defaultdict(lambda: dict(vals={}))
            for rr in range(r + 1, len(df)):
                lab, per = df.iat[rr, acc[0]], parse_period(df.iat[rr, dat[0]])
                if pd.isna(lab) or not per: continue
                v = clean_num(df.iat[rr, amt[0]]) if amt else (clean_num(df.iat[rr, deb[0]]) or 0) - (clean_num(df.iat[rr, cre[0]]) or 0)
                if v is None: continue
                sec = str(df.iat[rr, typ[0]]) if typ and not pd.isna(df.iat[rr, typ[0]]) else ""
                d = out[(str(lab).strip(), sec)]; d["vals"][per] = d["vals"].get(per, 0) + v
            return [dict(sheet=name, label=k[0], section=k[1], stmt=stmt_hint, vals=v["vals"], row=0) for k, v in out.items()]
    return None


# ------------------------------------------------------------------ main pipeline
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+"); ap.add_argument("--out", default="data.json")
    ap.add_argument("--company", default="Company"); ap.add_argument("--currency", default="$")
    ap.add_argument("--sheet", action="append"); ap.add_argument("--map")
    ap.add_argument("--fy-start", type=int, default=1); ap.add_argument("--tax-rate", type=float, default=0.25)
    ap.add_argument("--ytd", choices=["auto", "yes", "no"], default="auto")
    ap.add_argument("--close-earnings", action="store_true", help="add FY-to-date net income to retained earnings (source BS excludes current-year profit)")
    ap.add_argument("--plug-equity", action="store_true", help="push any remaining imbalance into other_equity (last resort, disclosed in notes)")
    ap.add_argument("--title", default="Monthly Performance Report"); ap.add_argument("--prepared-by", default="")
    ap.add_argument("--outdir", default=None)
    a = ap.parse_args()
    outdir = a.outdir or os.path.dirname(os.path.abspath(a.out)); os.makedirs(outdir, exist_ok=True)

    mapping = {}
    if a.map:
        for r in csv.DictReader(open(a.map, encoding="utf-8-sig")):
            if r.get("class"): mapping[norm_label(r["label"])] = r["class"].strip()

    issues = dict(skipped_rows=[], skipped_cols=[], subtotals=[], unmapped=[], low=[], flips=[], notes=[], warnings=[])
    rows = []
    for path in a.inputs:
        for name, df in read_grids(path, a.sheet).items():
            df = df.dropna(how="all").dropna(axis=1, how="all").reset_index(drop=True)
            if df.empty: continue
            hint = stmt_from_text(name)
            h = find_header(df)
            got = None
            if h: got = extract_wide(name, df, h[0], h[1], hint, issues)
            else:
                got = extract_long(name, df, hint, issues)
            if not got: issues["warnings"].append(f"Sheet '{name}': no period columns or long-format header found; skipped."); continue
            rows += got

    if not rows: raise SystemExit("No usable rows found. Check ingest_report.md / the file layout.")

    # skip subtotal rows (by name; by arithmetic)
    clean = []
    for i, r in enumerate(rows):
        if SUBTOTAL.match(r["label"]) and not (r["stmt"] == "BS" and re.match(r"\s*net (profit|income|loss|earnings)", r["label"], re.I)):
            issues["subtotals"].append(f"{r['sheet']}!{r['row']} '{r['label']}' (name looks like a computed total)"); r["skip"] = True
    for i, r in enumerate(rows):
        if r.get("skip") or not r["row"]: continue
        base = {p: v for p, v in r["vals"].items() if v}
        if not base: continue
        run = {p: 0.0 for p in r["vals"]}
        for j in range(i + 1, min(i + 40, len(rows))):
            n = rows[j]
            if n["sheet"] != r["sheet"] or n.get("skip"): continue
            for p in run: run[p] += n["vals"].get(p) or 0
            if j - i >= 2 and all(abs(run[p] - (r["vals"].get(p) or 0)) <= 1 for p in run) and any(run.values()):
                r["skip"] = True; issues["subtotals"].append(f"{r['sheet']}!{r['row']} '{r['label']}' (equals the sum of the {j-i} rows below it)"); break
    rows = [r for r in rows if not r.get("skip")]

    # classify
    for r in rows:
        cls, conf, why = classify(r["label"], r["section"], r["stmt"], mapping)
        r["cls"], r["conf"], r["why"] = cls, conf, why
        r["contra"] = bool(cls == "revenue" and re.search(CONTRA_REVENUE, r["label"], re.I))
        if cls is None: issues["unmapped"].append(r)
        elif conf < 0.7: issues["low"].append(r)

    # aggregate per class/period with sign normalisation
    cls_series = defaultdict(lambda: defaultdict(float))
    for r in rows:
        if not r["cls"]: continue
        for p, v in r["vals"].items():
            if v is None: continue
            cls_series[r["cls"]][p] += -abs(v) if r["contra"] else v
    # decide credit-negative file (trial-balance style)
    cred_signs = [1 if sum(cls_series[k].values()) > 0 else -1 for k in CREDIT if k in cls_series and k in ("revenue", "ap", "std", "ltd", "other_cl", "tax_liab", "other_equity") and abs(sum(cls_series[k].values())) > 0]
    credit_neg = bool(cred_signs) and sum(cred_signs) < 0 and cred_signs.count(-1) >= max(2, len(cred_signs) // 2 + 1) - 0
    if credit_neg:
        issues["flips"].append("Credit-side lines (revenue, liabilities, equity, other/interest income) arrive as negatives (trial-balance sign). Flipped to positive.")
        for k in CREDIT:
            for p in cls_series.get(k, {}): cls_series[k][p] *= -1
    for k in COSTS:
        s = cls_series.get(k)
        if s and sum(s.values()) < 0 and not credit_neg and k not in ("adjustments",):
            issues["flips"].append(f"'{k}' arrives negative (costs shown as negatives). Flipped to positive.")
            for p in s: s[p] *= -1
    if credit_neg:  # costs in a TB are debit-positive; if they are also negative something is off
        for k in COSTS:
            s = cls_series.get(k)
            if s and sum(s.values()) < 0 and k != "adjustments":
                issues["warnings"].append(f"'{k}' is negative while the file otherwise uses debit-positive costs; check sign or mapping.")

    pl_periods = sorted({p for k in PL_KEYS if k in cls_series for p in cls_series[k]})
    bs_periods = sorted({p for k in BS_KEYS if k in cls_series for p in cls_series[k]})
    periods = sorted(set(pl_periods) & set(bs_periods)) if pl_periods and bs_periods else sorted(set(pl_periods) | set(bs_periods))
    if pl_periods and bs_periods and set(pl_periods) ^ set(bs_periods):
        issues["warnings"].append(f"P&L has {len(pl_periods)} months, balance sheet {len(bs_periods)}; report uses the {len(periods)} months present in both.")
    if not bs_periods: issues["warnings"].append("NO BALANCE SHEET FOUND. Cash flow, working-capital, liquidity and return KPIs will be empty or wrong. Ask for a balance sheet.")
    if not pl_periods: issues["warnings"].append("NO P&L FOUND. Ask for the income statement.")
    # gaps
    if periods:
        ys = [int(p[:4]) * 12 + int(p[5:]) for p in periods]
        miss = [x for x in range(ys[0], ys[-1] + 1) if x not in ys]
        if miss: issues["warnings"].append("Missing months in the sequence: " + ", ".join(f"{(x-1)//12}-{(x-1)%12+1:02d}" for x in miss))

    # cumulative (YTD) P&L detection
    fy = a.fy_start
    def fy_of(p): y, m = int(p[:4]), int(p[5:]); return y if m >= fy else y - 1
    rev = cls_series.get("revenue", {}); decum = a.ytd == "yes"
    if a.ytd == "auto" and len(pl_periods) >= 6:
        inc = tot = 0
        for p0, p1 in zip(pl_periods, pl_periods[1:]):
            if fy_of(p0) == fy_of(p1) and rev.get(p0):
                tot += 1; inc += rev.get(p1, 0) >= rev.get(p0, 0)
        resets = sum(1 for p0, p1 in zip(pl_periods, pl_periods[1:]) if fy_of(p0) != fy_of(p1) and rev.get(p1, 0) < rev.get(p0, 0) * 0.6)
        if tot and inc / tot >= 0.9 and (resets or len({fy_of(p) for p in pl_periods}) == 1): decum = True
    if decum:
        issues["notes"].append("P&L columns were cumulative (year-to-date); converted to single months by subtracting the prior month inside each financial year.")
        for k in PL_KEYS:
            s = cls_series.get(k)
            if not s: continue
            prev = None; new = {}
            for p in sorted(s):
                new[p] = s[p] - (s[prev] if prev and fy_of(prev) == fy_of(p) else 0); prev = p
            cls_series[k] = defaultdict(float, new)

    # build months
    months = []
    for p in periods:
        months.append(dict(period=p, pl={k: round(cls_series[k].get(p, 0.0), 2) for k in PL_KEYS},
                           bs={k: round(cls_series[k].get(p, 0.0), 2) for k in BS_KEYS}))

    def totals(m):
        b, q = m["bs"], m["pl"]
        ta = sum(b[k] for k in ("cash", "ar", "inventory", "wip", "other_ca", "fixed_assets", "intangibles", "investments"))
        tle = sum(b[k] for k in ("std", "ap", "tax_liab", "other_cl", "ltd", "other_ncl", "retained_earnings", "other_equity"))
        ni = q["revenue"] - q["cos_variable"] - q["cos_fixed"] - q["cos_depreciation"] - q["exp_variable"] - q["exp_fixed"] - q["exp_depreciation"] \
             + q["other_income"] - q["other_expenses"] + q["interest_income"] - q["interest_expenses"] - q["tax_expenses"] - q["adjustments"]
        return ta - tle, ni - q["dividends"]

    imb = [(m["period"], totals(m)[0]) for m in months if m["bs"] and any(m["bs"].values())]
    if a.close_earnings and months:
        acc = 0; last_fy = None
        for m in months:
            f = fy_of(m["period"]);
            if f != last_fy: acc, last_fy = 0, f
            acc += totals(m)[1]; m["bs"]["retained_earnings"] = round(m["bs"]["retained_earnings"] + acc, 2)
        issues["notes"].append("Source balance sheet excluded current-year profit; financial-year-to-date net income was added to retained earnings so the balance sheet balances.")
        imb = [(m["period"], totals(m)[0]) for m in months]
    elif months and imb:
        # diagnostic: does the gap look like unclosed current-year profit?
        acc = 0; last_fy = None; hits = 0
        for m in months:
            f = fy_of(m["period"]);
            if f != last_fy: acc, last_fy = 0, f
            acc += totals(m)[1]
            if abs(totals(m)[0] - acc) <= max(2, abs(acc) * 0.01) and abs(acc) > 1: hits += 1
        if hits >= max(2, len(months) // 2):
            issues["warnings"].append("The balance sheet gap matches year-to-date net income in most months: the source BS probably leaves current-year profit unclosed. Re-run with --close-earnings.")
    if a.plug_equity:
        n = 0
        for m in months:
            d = totals(m)[0]
            if abs(d) > 0.5: m["bs"]["other_equity"] = round(m["bs"]["other_equity"] + d, 2); n += 1
        if n: issues["notes"].append(f"Balance sheet was out of balance in {n} month(s); the difference was pushed into Other Equity so the report can run. Treat balance-sheet-based ratios with caution until the source is fixed.")
        imb = [(m["period"], totals(m)[0]) for m in months]
    bad = [(p, d) for p, d in imb if abs(d) > 2]
    if bad: issues["warnings"].append(f"Balance sheet out of balance in {len(bad)} of {len(imb)} months (e.g. {bad[-1][0]}: {bad[-1][1]:,.0f}).")

    data = OrderedDict(company=a.company, currency=a.currency, fy_start_month=a.fy_start, tax_rate=a.tax_rate, title=a.title,
                       prepared_by=a.prepared_by, source=", ".join(os.path.basename(x) for x in a.inputs), targets={}, notes=issues["notes"], months=months)
    json.dump(data, open(a.out, "w"), indent=1, ensure_ascii=False)

    with open(os.path.join(outdir, "mapping_review.csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f); w.writerow(["label", "class", "confidence", "why", "section", "sheet", "last_value"])
        for r in sorted(rows, key=lambda r: (r["cls"] is not None, r["conf"])):
            last = [v for v in r["vals"].values() if v is not None]
            w.writerow([r["label"], r["cls"] or "", r["conf"], r["why"], r["section"], r["sheet"], last[-1] if last else ""])

    L = ["# Ingest report", "", f"- Months loaded: **{len(months)}** ({periods[0] if periods else '-'} to {periods[-1] if periods else '-'})",
         f"- Source lines used: **{len([r for r in rows if r['cls']])}** of {len(rows)} after removing subtotals", ""]
    def sec(title, items):
        if items: L.extend([f"## {title}", *[f"- {x}" for x in items], ""])
    sec("Warnings (resolve before sending)", issues["warnings"])
    sec("Unmapped lines (excluded from the report; add to a mapping CSV and re-run)",
        [f"{r['sheet']}: '{r['label']}' (section '{r['section']}', last value {[v for v in r['vals'].values() if v is not None][-1:] })" for r in issues["unmapped"]])
    sec("Low-confidence mappings (check these)", [f"'{r['label']}' -> {r['cls']} ({r['why']}, {r['conf']})" for r in issues["low"]])
    sec("Sign changes applied", issues["flips"]); sec("Other judgement calls", issues["notes"])
    sec("Rows skipped as subtotals", issues["subtotals"]); sec("Columns skipped", issues["skipped_cols"])
    open(os.path.join(outdir, "ingest_report.md"), "w", encoding="utf-8").write("\n".join(L))
    print("\n".join(L)); print(f"\nWrote {a.out}")


if __name__ == "__main__":
    main()

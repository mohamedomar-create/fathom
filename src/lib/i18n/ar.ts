import type { Dict } from "./en";
import { auth } from "./areas/auth";
import { account } from "./areas/account";
import { home } from "./areas/home";
import { fin } from "./areas/fin";
import { ana } from "./areas/ana";
import { sales } from "./areas/sales";
import { eu } from "./areas/eu";
import { exp } from "./areas/exp";
import { inv } from "./areas/inv";
import { bank } from "./areas/bank";
import { rp } from "./areas/rp";
import { plan } from "./areas/plan";
import { state } from "./areas/state";

/** The app's words in Arabic (Egyptian business usage, Modern Standard wording). */
export const ar: Dict = {
  lang: { name: "العربية", switchTo: "English", switchLabel: "اللغة" },
  shell: {
    backToCompanies: "العودة إلى الشركات",
    companies: "الشركات",
    allCompanies: "كل الشركات ←",
    demoCompany: "شركة تجريبية",
    reports: "التقارير",
    data: "البيانات",
    settings: "الإعدادات",
    sections: "الأقسام",
    reportsTip: "إنشاء تقرير / تنزيل PDF",
    reportsAria: "التقارير وملف PDF",
    accountMenu: "قائمة الحساب",
    myCompanies: "شركاتي",
    insights: "لوحة المؤشرات",
    account: "الحساب",
    orgSettings: "إعدادات المؤسسة",
    people: "إدارة المستخدمين",
    logout: "تسجيل الخروج",
  },
  sectors: { financials: "القوائم المالية", sales: "المبيعات", expenses: "المصروفات", inventory: "المخزون", payments: "المدفوعات", banking: "البنوك" },
  nav: {
    summary: ["الملخص", "الملخص التنفيذي"],
    "analysis/kpis": ["المؤشرات", "مؤشرات الأداء"],
    "analysis/explorer": ["مستكشف المؤشرات", "مستكشف المؤشرات"],
    "analysis/profitability": ["الربحية", "الربحية"],
    "analysis/cashflow": ["التدفق النقدي", "التدفق النقدي"],
    "analysis/growth": ["النمو", "النمو"],
    "analysis/trend": ["الاتجاه", "الاتجاه"],
    "analysis/goalseek": ["تحقيق الهدف", "تحقيق الهدف"],
    "analysis/forecast": ["التوقعات", "التوقعات"],
    "analysis/financials": ["القوائم", "القوائم المالية"],
    "analysis/real-profit": ["الربح الحقيقي", "الربح الحقيقي"],
    sales: ["نظرة عامة", "نظرة عامة على المبيعات"],
    "sales/products": ["المنتجات", "المنتجات والفئات"],
    "sales/customers": ["العملاء", "العملاء"],
    "sales/trend": ["الاتجاه", "اتجاه المبيعات"],
    "sales/end-users": ["المستخدمون النهائيون", "المستخدمون النهائيون (مبيعات الجهات المشترية)"],
    expenses: ["نظرة عامة", "نظرة عامة على المصروفات"],
    "expenses/accounts": ["الحسابات", "المصروفات حسب الحساب"],
    "expenses/suppliers": ["الموردون", "الموردون"],
    "expenses/trend": ["الاتجاه", "اتجاه المصروفات"],
    inventory: ["نظرة عامة", "نظرة عامة على المخزون"],
    "inventory/products": ["الأصناف", "المخزون حسب الصنف"],
    "inventory/movements": ["الحركات", "حركات المخزون"],
    "inventory/valuation": ["التقييم", "التقييم والمطابقة"],
    payments: ["نظرة عامة", "المدفوعات والمستحقات"],
    "payments/receivables": ["المستحقات", "مستحقات العملاء"],
    "payments/payables": ["الموردون", "مستحقات الموردين"],
    "payments/flows": ["المدفوعات", "المقبوضات والمدفوعات"],
    banking: ["الجاهزية البنكية", "الجاهزية للتمويل البنكي"],
  },
  dataNav: {
    title: "البيانات",
    sub: "دفتر الأستاذ العام هو سجلك الأساسي. كل ما عداه يضيف تفاصيل أو يتحقق منه، بهذا الترتيب.",
    tabs: { "": "الخطوات", "/upload": "الرفع", "/checks": "الفحوص والسجل", "/readiness": "الجاهزية", "/end-users": "المستخدمون النهائيون", "/odoo": "Odoo المباشر" },
  },
  settingsNav: {
    monthsLoaded: (n: number) => `عدد الأشهر المحمّلة: ${n}`,
    noData: "لا توجد بيانات بعد",
    items: {
      "data-setup": ["إعداد البيانات", "خطوة بخطوة، النماذج، الجاهزية"],
      "source-data": ["مصدر البيانات", "رفع ملف أو الربط مع Odoo"],
      "data-health": ["سلامة البيانات", "الأشهر، الفحوص، السجل والتراجع"],
      profile: ["ملف الشركة", "العملة، السنة، الضريبة، سياق الذكاء الاصطناعي"],
      "chart-of-accounts": ["دليل الحسابات", "التصنيف والسلوك"],
      kpis: ["المؤشرات", "اختيار المؤشرات وترتيبها"],
      targets: ["المستهدفات", "المستهدفات الشهرية"],
      alerts: ["التنبيهات", "الحدود"],
    },
  },
  period: {
    for: "عن ",
    upto: "حتى ",
    of: "",
    month: "شهر",
    quarter: "ربع",
    year: "سنة",
    selectMonth: "اختر شهرًا",
    prevYear: "السنة السابقة",
    nextYear: "السنة التالية",
    noMonth: "لا توجد بيانات لهذا الشهر",
    partTitle: "أرقام آخر شهر تتوقف عند هذا اليوم، فهي تغطي جزءًا من الشهر فقط.",
    part: (day: number, month: string) => `جزء من الشهر، حتى ${day} ${month}`,
  },
  noData: {
    title: "لا توجد بيانات مالية بعد",
    body: (name: string) => `ارفع ملفًا من Odoo أو اربط قاعدة بيانات Odoo لترى المؤشرات ونقطة التعادل والتدفق النقدي وغيرها لشركة ${name}.`,
    add: "إضافة بيانات مالية",
  },
  health: (n: number) => `عدد الفحوص المحاسبية التي لم تنجح في بيانات هذه الشركة: ${n} (مثلًا الميزانية غير متوازنة). قد تكون الأرقام غير صحيحة: راجعها في سلامة البيانات.`,
  footer: { operatedBy: (entity: string) => `تديرها ${entity}`, privacy: "الخصوصية", terms: "الشروط", contact: "تواصل معنا", legal: "قانوني", effective: "سارية من" },
  dialog: { close: "إغلاق" },
  auth: auth.ar,
  account: account.ar,
  home: home.ar,
  fin: fin.ar,
  ana: ana.ar,
  sales: sales.ar,
  eu: eu.ar,
  exp: exp.ar,
  inv: inv.ar,
  bank: bank.ar,
  state: state.ar,
  rp: rp.ar,
  plan: plan.ar,
};

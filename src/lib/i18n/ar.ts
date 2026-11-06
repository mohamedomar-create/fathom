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
import { cash } from "./areas/cash";
import { hl } from "./areas/hl";
import { bud } from "./areas/bud";
import { doc } from "./areas/doc";
import { ink } from "./areas/ink";
import { mods } from "./areas/mods";
import { val } from "./areas/val";
import { bp } from "./areas/bp";
import { viz } from "./areas/viz";
import { bank } from "./areas/bank";
import { rp } from "./areas/rp";
import { plan } from "./areas/plan";
import { state } from "./areas/state";
import { access } from "./areas/access";
import { setx } from "./areas/setx";
import { wiz } from "./areas/wiz";
import { dat } from "./areas/dat";
import { rep } from "./areas/rep";
import { pay } from "./areas/pay";
import { msg } from "./areas/msg";

/** The app's words in Arabic (Egyptian business usage, Modern Standard wording). */
export const ar: Dict = {
  lang: { name: "العربية", switchTo: "English", switchLabel: "اللغة" },
  shell: {
    backToCompanies: "العودة إلى الشركات", moreModules: "المزيد",
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
  navGroups: { overview: "نظرة عامة", performance: "الأداء", cash: "النقدية والقوائم", plan: "التخطيط" },
  bottom: { home: "الرئيسية", pages: "الصفحات", more: "المزيد", sectionPages: "صفحات هذا القسم", everything: "كل الأقسام" },
  sectors: { financials: "القوائم المالية", sales: "المبيعات", expenses: "المصروفات", inventory: "المخزون", payments: "المدفوعات", banking: "البنوك", planning: "التخطيط", doctor: "الطبيب", valuation: "التقييم", modules: "الوحدات" },
  nav: {
    summary: ["الملخص", "الملخص التنفيذي"],
    "analysis/kpis": ["المؤشرات", "مؤشرات الأداء"],
    "analysis/explorer": ["مستكشف المؤشرات", "مستكشف المؤشرات"],
    "analysis/profitability": ["الربحية", "الربحية"],
    "analysis/cashflow": ["التدفق النقدي", "التدفق النقدي"],
    "analysis/growth": ["النمو", "النمو"],
    "analysis/trend": ["الاتجاه", "الاتجاه"],
    "analysis/goalseek": ["تحقيق الهدف", "تحقيق الهدف"],
    "analysis/budget": ["الموازنة", "الموازنة"],
    planning: ["خطة العمل", "خطة العمل"],
    "planning/budget": ["الموازنة", "الموازنة"],
    doctor: ["طبيب النظام", "طبيب النظام الذكي"],
    valuation: ["التقييم", "التقييم"],
    "valuation/methods": ["طرق التقييم", "طرق التقييم"],
    "valuation/assumptions": ["الافتراضات", "افتراضات التقييم"],
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
    "modules/purchasing": ["المشتريات", "المشتريات"],
    "modules/hr": ["الموارد البشرية", "الموارد البشرية"],
    "modules/payroll": ["الرواتب", "الرواتب"],
    "modules/crm": ["إدارة العملاء", "إدارة العملاء"],
    "modules/manufacturing": ["التصنيع", "التصنيع"],
    "modules/projects": ["المشاريع", "المشاريع"],
    "modules/pos": ["نقاط البيع", "نقاط البيع"],
    "modules/assets": ["الأصول الثابتة", "الأصول الثابتة"],
    "modules/fleet": ["الأسطول", "الأسطول"],
    "modules/service": ["الخدمة", "الخدمة"],
    inventory: ["نظرة عامة", "نظرة عامة على المخزون"],
    "inventory/products": ["الأصناف", "المخزون حسب الصنف"],
    "inventory/movements": ["الحركات", "حركات المخزون"],
    "inventory/valuation": ["تقييم المخزون", "تقييم المخزون والمطابقة"],
    payments: ["نظرة عامة", "المدفوعات والمستحقات"],
    "payments/receivables": ["المستحقات", "مستحقات العملاء"],
    "payments/payables": ["الموردون", "مستحقات الموردين"],
    "payments/flows": ["المدفوعات", "المقبوضات والمدفوعات"],
    banking: ["الجاهزية البنكية", "الجاهزية للتمويل البنكي"],
  },
  dataNav: {
    title: "البيانات",
    sub: "دفتر الأستاذ العام هو سجلك الأساسي. كل ما عداه يضيف تفاصيل أو يتحقق منه، بهذا الترتيب.",
    tabs: { steps: "الخطوات", checks: "الفحوص والسجل", connections: "الاتصالات" },
    sub2: { steps: "الخطوات", intake: "الرفع الذكي", readiness: "الجاهزية حسب القسم", upload: "رفع ملف", odoo: "Odoo المباشر", endUsers: "المستخدمون النهائيون" },
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
      close: ["إقفال الشهر", "إقفال الأشهر وإعادة فتحها"],
      modules: ["الوحدات", "المجالات التي تضيفها ومن يرى كلًا منها"],
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
    bodyOther: (name: string) => `ارفع دفتر الأستاذ العام أو ميزان المراجعة (Excel أو CSV) لترى المؤشرات ونقطة التعادل والتدفق النقدي وغيرها لشركة ${name}.`,
    add: "إضافة بيانات مالية",
    home: "وحداتك",
    homeBody: (name: string) => `ما رفعته ${name} حتى الآن. تعمل كل وحدة وحدها؛ أضف الدفاتر لترى الربح والنقد والمؤشرات أيضًا.`,
    homeNone: "لا توجد بيانات في أي وحدة بعد. ابدأ بأي ملف: المبيعات أو المصروفات أو المخزون أو المدفوعات أو الدفاتر.",
    seeModules: "عرض وحداتك",
    latest: (m: string) => `آخر شهر ${m}`,
    monthsLoaded: (n: number) => `${n} شهر محمّل`,
    open: "فتح",
    pages: { summary: "الملخص التنفيذي: الربح والنقدية وما يحتاج انتباهك في صفحة واحدة.", kpis: "مؤشراتك مقارنةً بأهدافك.", banking: "كيف يقرأ البنك شركتك: تغطية السداد والرفع المالي وقدرة الاقتراض.", valuation: "كم تساوي شركتك، من قيمة البيع السريع إلى ما قد يدفعه مستثمر.", doctor: "طبيب النظام الذكي: ما الخطأ في الدفاتر مرتبًا حسب المبلغ المعرّض.", planning: "موازنتك وخطة عملك مبنية على أرقامك.", analysis: "القوائم والربحية والنمو والاتجاهات والتوقعات." } as Record<string, string>,
  },
  healthUnknown: "تعذّرت قراءة الفحوص المحاسبية لهذه الشركة الآن، فلا يمكن معرفة ما إذا كانت أرقامها تجتازها. أعد تحميل الصفحة للمحاولة مرة أخرى.",
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
  cash: cash.ar,
  hl: hl.ar,
  bud: bud.ar,
  doc: doc.ar,
  ink: ink.ar,
  mods: mods.ar,
  val: val.ar,
  bp: bp.ar,
  viz: viz.ar,
  bank: bank.ar,
  state: state.ar,
  access: access.ar,
  rp: rp.ar,
  plan: plan.ar,
  setx: setx.ar,
  wiz: wiz.ar,
  dat: dat.ar,
  rep: rep.ar,
  pay: pay.ar,
  msg: msg.ar,
};

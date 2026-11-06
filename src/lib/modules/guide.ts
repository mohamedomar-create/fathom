// How to get each module's data out of the ERP, step by step, the way the built-in areas guide the person: the menu to
// open, what to select, the export to choose, then the upload. Every module also has the plain-Excel route (iReport's
// own template), so a company on any system, or none, can bring the data.
import type { Bi } from "./types";

export type GuideSystem = "odoo" | "sap" | "dynamics" | "excel";
export const GUIDE_SYSTEMS: GuideSystem[] = ["odoo", "sap", "dynamics", "excel"];
export interface ModuleGuide { steps: Bi[]; tip?: Bi }

const b = (en: string, ar: string): Bi => ({ en, ar });

/** The last step of every ERP route: what to upload, and where. */
const UPLOAD = b("Save the export as .xlsx and drop it on Data ▸ Smart upload. iReport reads the headings, shows what it understood, and saves nothing until you confirm.",
  "احفظ الملف بصيغة xlsx وأفلته في البيانات ▸ الرفع الذكي. يقرأ iReport العناوين ويعرض ما فهمه، ولا يحفظ شيئًا حتى تؤكد.");
const ODOO_LIST = b("Switch to the list view, tick the box at the top, then \"Select all\" so every record is exported, not just this page.",
  "انتقل إلى عرض القائمة، وحدد المربع في الأعلى ثم \"تحديد الكل\" حتى تُصدَّر كل السجلات لا هذه الصفحة فقط.");
const ODOO_EXPORT = (fields: string, ar: string) => b(`Action ▸ Export. Add the fields: ${fields}. Keep "I want to update data" ticked so each row carries its ID.`,
  `إجراء ▸ تصدير. أضف الحقول: ${ar}. اترك "أريد تحديث البيانات" محددًا حتى يحمل كل صف رقمه.`);

const GUIDES: Record<string, Partial<Record<Exclude<GuideSystem, "excel">, Bi[]>> & { tip?: Bi }> = {
  hr: {
    odoo: [b("Open Employees.", "افتح الموظفين."), ODOO_LIST, ODOO_EXPORT("Employee name, Badge ID, Department, Job position, Work location, Contract wage, Start date", "اسم الموظف، رقم الشارة، القسم، الوظيفة، موقع العمل، أجر العقد، تاريخ البدء")],
    sap: [b("Open the employee list (Fiori \"Employee Lists\", or an Ad Hoc Query on Personnel Administration) with personnel number, name, org. unit, position, hire date and monthly salary.", "افتح قائمة الموظفين (تطبيق Fiori \"Employee Lists\" أو استعلامًا مخصصًا على إدارة شؤون الموظفين) بالرقم الوظيفي والاسم والوحدة التنظيمية والوظيفة وتاريخ التعيين والراتب الشهري."),
      b("Run it for the active employees on the day you want the list at (the as-of day), then Export ▸ Spreadsheet.", "شغّله للموظفين النشطين في اليوم الذي تريد القائمة فيه (تاريخ الحصر)، ثم تصدير ▸ جدول بيانات.")],
    dynamics: [b("Human resources ▸ Workers ▸ All workers (Business Central: Employees).", "الموارد البشرية ▸ العاملون ▸ كل العاملين (في Business Central: الموظفون)."),
      b("Add the columns department, position, start date and salary, then Open in Excel / Export to Excel.", "أضف أعمدة القسم والوظيفة وتاريخ البدء والراتب، ثم فتح في Excel / تصدير إلى Excel.")],
    tip: b("An employee list is held at one day: iReport asks for that as-of day, and never dates it by the hire date.", "قائمة الموظفين محصورة في يوم واحد: يطلب iReport ذلك اليوم، ولا يؤرخها بتاريخ التعيين أبدًا."),
  },
  payroll: {
    odoo: [b("Open Payroll ▸ Payslips (or Reporting ▸ Payroll analysis).", "افتح الرواتب ▸ قسائم الرواتب (أو التقارير ▸ تحليل الرواتب)."), ODOO_LIST, ODOO_EXPORT("Employee, Department, Period, Gross, Deductions, Net wage", "الموظف، القسم، الفترة، الإجمالي، الاستقطاعات، صافي الأجر")],
    sap: [b("Run the Payroll Journal (PC00_M99_CLJN) for the months you want, one line per employee and period.", "شغّل دفتر يومية الرواتب (PC00_M99_CLJN) للأشهر التي تريدها، سطر لكل موظف وفترة."), b("Export ▸ Spreadsheet.", "تصدير ▸ جدول بيانات.")],
    dynamics: [b("Payroll ▸ Pay statements (Business Central: the payroll provider's posted payroll report).", "الرواتب ▸ كشوف الأجور (في Business Central: تقرير الرواتب المرحّلة من مزود الرواتب)."), b("Filter the months, then Export to Excel.", "صفّ الأشهر، ثم تصدير إلى Excel.")],
    tip: b("Payroll is checked against the salary accounts in your books, month by month.", "تُطابق الرواتب مع حسابات الرواتب في دفاترك شهرًا بشهر."),
  },
  crm: {
    odoo: [b("Open CRM ▸ Pipeline.", "افتح إدارة العملاء ▸ مسار الفرص."), ODOO_LIST, ODOO_EXPORT("Opportunity, Customer, Stage, Salesperson, Expected revenue, Probability, Expected closing", "الفرصة، العميل، المرحلة، مندوب المبيعات، الإيراد المتوقع، الاحتمال، تاريخ الإغلاق المتوقع")],
    sap: [b("SAP Sales Cloud ▸ Opportunities (S/4HANA: the opportunity list in Sales).", "SAP Sales Cloud ▸ الفرص (S/4HANA: قائمة الفرص في المبيعات)."), b("Show all open and closed opportunities with stage, owner, value and close date, then Export to Excel.", "اعرض كل الفرص المفتوحة والمغلقة بالمرحلة والمسؤول والقيمة وتاريخ الإغلاق، ثم تصدير إلى Excel.")],
    dynamics: [b("Dynamics 365 Sales ▸ Opportunities ▸ All opportunities.", "Dynamics 365 Sales ▸ الفرص ▸ كل الفرص."), b("Export to Excel ▸ Static worksheet.", "تصدير إلى Excel ▸ ورقة ثابتة.")],
    tip: b("Opportunities are a forecast, never revenue: they are not added to Sales, and lost ones are left out of the totals.", "الفرص توقع وليست إيرادًا: لا تُضاف إلى المبيعات، وتُستبعد الفرص الخاسرة من الإجماليات."),
  },
  manufacturing: {
    odoo: [b("Open Manufacturing ▸ Operations ▸ Manufacturing Orders, filter Done.", "افتح التصنيع ▸ العمليات ▸ أوامر التصنيع، وصفِّ المنتهية."), ODOO_LIST, ODOO_EXPORT("Reference, Product, Quantity produced, Date, Work center, Cost", "المرجع، المنتج، الكمية المنتجة، التاريخ، مركز العمل، التكلفة")],
    sap: [b("Run COOIS (production order information system) for confirmed orders in the period.", "شغّل COOIS (نظام معلومات أوامر الإنتاج) للأوامر المؤكدة في الفترة."), b("Choose the columns order, material, confirmed quantity, finish date, work center and actual cost, then Export ▸ Spreadsheet.", "اختر أعمدة الأمر والمادة والكمية المؤكدة وتاريخ الانتهاء ومركز العمل والتكلفة الفعلية، ثم تصدير ▸ جدول بيانات.")],
    dynamics: [b("Production control ▸ Production orders ▸ All production orders, filter Ended.", "التحكم في الإنتاج ▸ أوامر الإنتاج ▸ كل الأوامر، وصفِّ المنتهية."), b("Open in Excel.", "فتح في Excel.")],
    tip: b("Production cost is checked against the cost of sales in your books.", "تُطابق تكلفة الإنتاج مع تكلفة المبيعات في دفاترك."),
  },
  projects: {
    odoo: [b("Open Timesheets ▸ All Timesheets (or Project ▸ Reporting).", "افتح سجلات الوقت ▸ كل السجلات (أو المشاريع ▸ التقارير)."), ODOO_LIST, ODOO_EXPORT("Date, Employee, Project, Task, Hours spent, Cost", "التاريخ، الموظف، المشروع، المهمة، الساعات، التكلفة")],
    sap: [b("Run CADO (time sheet display) or the PS cost report for the period.", "شغّل CADO (عرض سجلات الوقت) أو تقرير تكاليف المشاريع للفترة."), b("Export ▸ Spreadsheet.", "تصدير ▸ جدول بيانات.")],
    dynamics: [b("Project management and accounting ▸ Timesheets ▸ All timesheets (Business Central: Jobs ▸ Time sheets).", "إدارة المشاريع ▸ سجلات الوقت ▸ كل السجلات (في Business Central: الأعمال ▸ سجلات الوقت)."), b("Export to Excel.", "تصدير إلى Excel.")],
  },
  pos: {
    odoo: [b("Open Point of Sale ▸ Orders ▸ Orders.", "افتح نقاط البيع ▸ الطلبات ▸ الطلبات."), ODOO_LIST, ODOO_EXPORT("Order ref, Date, Shop, Cashier, Customer, Total", "مرجع الطلب، التاريخ، المتجر، الكاشير، العميل، الإجمالي")],
    sap: [b("SAP Customer Checkout (or POS Data Management) ▸ the sales transactions report for the period.", "SAP Customer Checkout (أو إدارة بيانات نقاط البيع) ▸ تقرير معاملات المبيعات للفترة."), b("Export to Excel.", "تصدير إلى Excel.")],
    dynamics: [b("Retail and Commerce ▸ Inquiries ▸ Transactions (Business Central: LS Central or the POS add-on's sales).", "التجزئة والتجارة ▸ الاستعلامات ▸ المعاملات (في Business Central: مبيعات LS Central أو إضافة نقاط البيع)."), b("Export to Excel.", "تصدير إلى Excel.")],
    tip: b("Point-of-sale takings are checked against sales in your books; they are never added to Sales twice.", "تُطابق مبيعات نقاط البيع مع المبيعات في دفاترك، ولا تُضاف إلى المبيعات مرتين."),
  },
  assets: {
    odoo: [b("Open Accounting ▸ Accounting ▸ Assets.", "افتح المحاسبة ▸ المحاسبة ▸ الأصول."), ODOO_LIST, ODOO_EXPORT("Asset name, Asset group, Acquisition date, Original value, Book value", "اسم الأصل، المجموعة، تاريخ الاقتناء، القيمة الأصلية، القيمة الدفترية")],
    sap: [b("Run the Asset History Sheet (S_ALR_87011990) or Asset Balances (AR01) at the day you want.", "شغّل سجل تاريخ الأصول (S_ALR_87011990) أو أرصدة الأصول (AR01) في اليوم الذي تريده."), b("Export ▸ Spreadsheet.", "تصدير ▸ جدول بيانات.")],
    dynamics: [b("Fixed assets ▸ Fixed assets (Business Central: Fixed Assets list with book value).", "الأصول الثابتة ▸ الأصول الثابتة (في Business Central: قائمة الأصول بالقيمة الدفترية)."), b("Open in Excel.", "فتح في Excel.")],
    tip: b("The register is held at one day and checked against the fixed-asset accounts in your books at that month end.", "السجل محصور في يوم واحد ويُطابق مع حسابات الأصول الثابتة في دفاترك في نهاية ذلك الشهر."),
  },
  fleet: {
    odoo: [b("Open Fleet ▸ Vehicles ▸ Services (or Costs).", "افتح الأسطول ▸ المركبات ▸ الخدمات (أو التكاليف)."), ODOO_LIST, ODOO_EXPORT("Vehicle, Driver, Date, Service type, Cost, Odometer", "المركبة، السائق، التاريخ، نوع الخدمة، التكلفة، العداد")],
    sap: [b("Run the equipment list (IE05) with the maintenance costs report (IW39 orders) for the period.", "شغّل قائمة المعدات (IE05) مع تقرير تكاليف الصيانة (أوامر IW39) للفترة."), b("Export ▸ Spreadsheet.", "تصدير ▸ جدول بيانات.")],
    dynamics: [b("Asset management ▸ Assets, or Fleet management ▸ Vehicle costs.", "إدارة الأصول ▸ الأصول، أو إدارة الأسطول ▸ تكاليف المركبات."), b("Export to Excel.", "تصدير إلى Excel.")],
  },
  service: {
    odoo: [b("Open Helpdesk ▸ Tickets (or Field Service ▸ Tasks).", "افتح الدعم الفني ▸ التذاكر (أو الخدمة الميدانية ▸ المهام)."), ODOO_LIST, ODOO_EXPORT("Ticket, Customer, Team, Stage, Created on, Hours spent", "التذكرة، العميل، الفريق، المرحلة، تاريخ الإنشاء، الساعات")],
    sap: [b("Run the service orders list (IW73) or the Service Cloud tickets report for the period.", "شغّل قائمة أوامر الخدمة (IW73) أو تقرير تذاكر Service Cloud للفترة."), b("Export ▸ Spreadsheet.", "تصدير ▸ جدول بيانات.")],
    dynamics: [b("Customer Service ▸ Cases ▸ All cases.", "خدمة العملاء ▸ الحالات ▸ كل الحالات."), b("Export to Excel ▸ Static worksheet.", "تصدير إلى Excel ▸ ورقة ثابتة.")],
  },
};

/** The plain-Excel route: iReport's own template for the module. */
const EXCEL: Bi[] = [
  b("Download this module's template: a Data sheet with its headings, and a Read me with what each column holds.", "نزّل قالب هذه الوحدة: ورقة بيانات بعناوينها، وورقة اقرأني تشرح محتوى كل عمود."),
  b("Fill one row per record from your system or your own sheet. Keep the headings as they are; extra columns are listed and left out.", "املأ صفًا لكل سجل من نظامك أو من ملفك. اترك العناوين كما هي؛ الأعمدة الإضافية تُعرض وتُستبعد."),
  UPLOAD,
];

/** The steps to bring a module's data from one system; a module with no ERP guide (one the company built) has the template route. */
export function moduleGuide(m: { key: string }, system: GuideSystem): ModuleGuide {
  const g = GUIDES[m.key];
  const tip = g?.tip;
  if (system === "excel" || !g?.[system]) return { steps: EXCEL, ...(tip ? { tip } : {}) };
  return { steps: [...g[system]!, UPLOAD], ...(tip ? { tip } : {}) };
}

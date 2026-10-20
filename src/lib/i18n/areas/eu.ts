import { area } from "../types";

/** Sales → End users: who really bought, when a buying agency is billed for hospitals. */
export const eu = area(
  {
    none: "No agency sales found",
    noneText: "Some customers buy on behalf of others: Egypt's Unified Procurement Authority is invoiced for what each hospital ordered. iReport finds the hospital from Odoo's own links: the invoice's sales order, the contact it was addressed to, or its delivery address.",
    noneHow: "To fill this page: on Data ▸ Odoo live, press Sync detail. The sync reads each invoice line's sales order (read only).",
    definition: "Net sales = customer invoices minus credit notes, posted only, before tax. Cancelled and draft invoices are not in it.",
    agencies: (names: string) => `Agencies: ${names}.`,
    total: "Agency sales", hospitals: "Hospitals", coverage: "Placed on a hospital", unmapped: "Unmapped", largest: "Largest hospital",
    ofAgency: "of agency sales", exactOnly: "exact links only", noLink: "no order, contact, delivery or register link",
    ties: (n: number) => `Every pound of agency sales is accounted for: placed on a hospital or listed as Unmapped, in ${n === 1 ? "the month" : `all ${n} months`}.`,
    differs: (n: number) => `${n} month${n === 1 ? "" : "s"} here differ from agency sales on the Sales pages:`,
    hospitalsH: "Sales by hospital", allH: "All hospitals", hospital: "Hospital", share: "Share", total2: "Total", earlier: "Earlier", topCategory: "Largest category",
    howH: "How each month was placed", month: "Month", byOrder: "Sales order", byContact: "Invoice contact", byShipping: "Delivery address", byRegister: "Order register",
    howNote: "Sales order: the invoice line's own order (its customer is the hospital). Invoice contact and delivery address: who the invoice was addressed or delivered to. Order register: your list of agency order numbers. Nothing is placed by matching amounts.",
    unmappedH: "Unmapped agency sales", unmappedText: "These lines have no link to a hospital in Odoo. They stay here until Odoo links them to their order, or you add their agency order number to the register.",
    description: "Description", lines: "Lines", months: "Months", fix: "Add order numbers or merge spellings",
    showing: (max: number, n: number) => `Showing the largest ${max} of ${n}.`,
  },
  {
    none: "لا توجد مبيعات لجهات مشترية",
    noneText: "بعض العملاء يشترون نيابة عن غيرهم: الهيئة المصرية للشراء الموحد تُفوتر بما طلبه كل مستشفى. يحدد iReport المستشفى من روابط Odoo نفسها: أمر البيع الخاص بالفاتورة، أو جهة الاتصال الموجهة إليها، أو عنوان التسليم.",
    noneHow: "لملء هذه الصفحة: من البيانات ▸ Odoo المباشر اضغط مزامنة التفاصيل. تقرأ المزامنة أمر البيع لكل بند فاتورة (قراءة فقط).",
    definition: "صافي المبيعات = فواتير العملاء ناقص إشعارات الدائن، المرحّلة فقط، قبل الضريبة. الفواتير الملغاة والمسودات غير داخلة.",
    agencies: (names: string) => `الجهات المشترية: ${names}.`,
    total: "مبيعات الجهات المشترية", hospitals: "المستشفيات", coverage: "منسوبة إلى مستشفى", unmapped: "غير منسوبة", largest: "أكبر مستشفى",
    ofAgency: "من مبيعات الجهات", exactOnly: "روابط مؤكدة فقط", noLink: "بلا رابط بأمر بيع أو جهة اتصال أو تسليم أو سجل",
    ties: (n: number) => `كل جنيه من مبيعات الجهات محسوب: منسوب إلى مستشفى أو مدرج كغير منسوب، ${n === 1 ? "في الشهر" : `في كل الأشهر (${n})`}.`,
    differs: (n: number) => `عدد الأشهر التي تختلف هنا عن مبيعات الجهات في صفحات المبيعات: ${n}`,
    hospitalsH: "المبيعات حسب المستشفى", allH: "كل المستشفيات", hospital: "المستشفى", share: "النسبة", total2: "الإجمالي", earlier: "قبل ذلك", topCategory: "أكبر فئة",
    howH: "كيف نُسب كل شهر", month: "الشهر", byOrder: "أمر البيع", byContact: "جهة اتصال الفاتورة", byShipping: "عنوان التسليم", byRegister: "سجل الأوامر",
    howNote: "أمر البيع: الأمر الخاص ببند الفاتورة (عميله هو المستشفى). جهة الاتصال وعنوان التسليم: من وُجهت إليه الفاتورة أو سُلمت إليه. سجل الأوامر: قائمتك بأرقام أوامر الجهة. لا يُنسب شيء بمطابقة المبالغ.",
    unmappedH: "مبيعات جهات غير منسوبة", unmappedText: "هذه البنود بلا رابط بمستشفى في Odoo. تبقى هنا حتى يربطها Odoo بأمرها، أو تضيف رقم أمر الجهة إلى السجل.",
    description: "البيان", lines: "البنود", months: "الأشهر", fix: "أضف أرقام الأوامر أو وحّد الأسماء",
    showing: (max: number, n: number) => `عرض أكبر ${max} من ${n}.`,
  },
);

/**
 * What kind of entry a document number is, from its series (the prefix before the first "/"): a vendor bill or refund,
 * a purchase or expense-journal entry, a customer invoice, a stock valuation entry, or something else.
 */

/** "INV/2026/0044" → "INV"; "RINV/2026/0003" → "RINV"; "WH/OUT/00012" → "WH". */
export const seriesOf = (doc: string) => (doc.match(/^([A-Za-z][A-Za-z0-9]*)[/\-]/)?.[1] ?? "").toUpperCase();

/** Vendor bills and refunds: "BILL/2026/0001", "RBILL/…". */
export const isBillDoc = (doc: string) => /^R?BILL$/.test(seriesOf(doc));

/** Entries whose partner is someone the company pays: vendor bills and refunds, purchase and expense journals. */
const PURCHASE = /^(R?BILL|R?EXP|R?PURCH?|PO|VB|VBILL)\d*$/;
/** Customer invoices and credit notes: their partner is a customer, whatever account a line sits on. */
const CUSTOMER = /^R?INV\d*$/;
/** Stock valuation entries (cost of goods moved out of stock): their partner, if any, is usually the customer delivered to. */
const STOCK = /^(STJ|WH|STK|STOCK|STV|SVL|SV)\d*$/;

export type DocKind = "purchase" | "customer" | "stock" | "other";
export function docKind(doc: string): DocKind {
  const s = seriesOf(doc);
  return PURCHASE.test(s) ? "purchase" : CUSTOMER.test(s) ? "customer" : STOCK.test(s) ? "stock" : "other";
}

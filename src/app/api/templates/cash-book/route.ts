import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** A blank cash book sheet: one row per day or per movement, money in and money out in their own columns. */
export async function GET() {
  const XLSX = await import("@e965/xlsx");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Date", "Description", "Category", "Customer / supplier", "In", "Out", "Paid"],
    ["01/03/2026", "Sales of the day", "Sales", "", 1500, "", "Yes"],
    ["01/03/2026", "Bread and milk", "Stock", "Local bakery", "", 400, "Yes"],
  ]);
  ws["!cols"] = [{ wch: 12 }, { wch: 28 }, { wch: 16 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, ws, "Cash book");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["How to fill it"],
    ["One row for each sale or expense, or one row for each day's totals. Date and an amount (In or Out) are enough."],
    ["Category, customer / supplier and Paid are optional. Paid: Yes or No (No = still to be paid)."],
    ["Delete the two example rows before uploading. Arabic headings work too: التاريخ، البيان، الفئة، وارد، منصرف، مدفوع."],
  ]), "Read me");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="cash-book-template.xlsx"', "Cache-Control": "public, max-age=3600" },
  });
}

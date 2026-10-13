import { z } from "zod";

/** What the reader returns for one page of a financial PDF: its columns of figures and its rows, as printed. */
export const PageSchema = z.object({
  kind: z.enum(["pl", "bs", "tb", "gl", "sales", "other"]),
  title: z.string(),
  company: z.string(),
  currency: z.string(),
  scale: z.enum(["units", "thousands", "millions"]),
  dateText: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.object({
    code: z.string(),
    label: z.string(),
    values: z.array(z.number().nullable()),
    total: z.boolean(),
    heading: z.boolean(),
    unclear: z.boolean(),
  })),
});
export type PageRead = z.infer<typeof PageSchema>;
export type PageRow = PageRead["rows"][number];

/** Largest single page sent for reading: one page per request keeps each call inside the 4.5 MB request and 60-second limits. */
export const MAX_PAGE_BYTES = 3_500_000;

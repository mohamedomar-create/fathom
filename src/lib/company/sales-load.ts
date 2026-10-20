import "server-only";
import { cache } from "react";
import { EMPTY_SALES, type SalesData } from "@/lib/engine";
import { parseSalesSummary } from "./sales-parse";
import { loadKept } from "./summary-load";
import type { Loaded } from "./loaded";

export const noSales = (d: SalesData) => d.customers.length === 0 && d.products.length === 0;

/** The company's sales, added up by customer and by product per month, with whether they could be read (members only). */
export const loadSales = cache((companyId: string): Promise<Loaded<SalesData>> => loadKept("sales", companyId, parseSalesSummary, EMPTY_SALES, noSales));

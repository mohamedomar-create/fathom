/** kpi_config also holds settings that are not KPIs, under these keys. Kept apart from load.ts so client and export code can use them. */
export const ECONOMY_KEY = "economy";
/** The saved forecast drivers. */
export const FORECAST_KEY = "forecast";
/** Keys in kpi_config that are not KPIs. */
export const RESERVED_KEYS: string[] = [ECONOMY_KEY, FORECAST_KEY];

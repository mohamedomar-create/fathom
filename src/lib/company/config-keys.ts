/** kpi_config also holds settings that are not KPIs, under these keys. Kept apart from load.ts so client and export code can use them. */
export const ECONOMY_KEY = "economy";
/** The saved forecast drivers. */
export const FORECAST_KEY = "forecast";
/** Keys in kpi_config that are not KPIs. */
/** Inventory settings: the location rented items go to. */
export const INVENTORY_KEY = "inventory";
/** Company profile settings kept with the KPI settings: the time zone. */
export const PROFILE_KEY = "profile";
export const RESERVED_KEYS: string[] = [ECONOMY_KEY, FORECAST_KEY, INVENTORY_KEY, PROFILE_KEY];

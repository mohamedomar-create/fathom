"use client";
import { createContext, useContext } from "react";

/** When true, charts render their final state immediately (no draw-in animation, no tooltips) — used for reports and PDF. */
export const StaticCharts = createContext(false);
export const useStaticCharts = () => useContext(StaticCharts);

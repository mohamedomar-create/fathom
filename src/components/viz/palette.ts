/**
 * One source for chart colours (mirrors the tokens in globals.css). The categorical order is the validated one
 * (dataviz validator, light surface: all adjacent pairs pass CVD and normal-vision floors); slots 3-5 sit under 3:1 on
 * white, so charts that use them carry direct labels or a table view.
 */
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"] as const;
export const INK = { primary: "#222222", secondary: "#52514e", muted: "#66665f", grid: "#e1e0d9", axis: "#c3c2b7", surface: "#ffffff", panel: "#fbfbfa" } as const;
export const BRAND = { main: "#0f8b8d", dark: "#0b6e70", soft: "#ddf1f1" } as const;
/** Better / worse (a change's meaning, always paired with an arrow and a sign), and the neutral middle. */
export const TONE = { good: "#2e9e6a", goodText: "#1d6b46", bad: "#d9343a", badText: "#b8242a", neutral: "#a9a9a3" } as const;
/** Status, reserved (never a series colour); always shown with an icon or a label. */
export const STATUS = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b" } as const;
/** Sequential (one hue, light to dark) for heat maps. */
export const SEQ = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"] as const;
/** Text colour that stays readable on a sequential step. */
export const seqInk = (i: number) => (i >= 4 ? "#ffffff" : "#0b0b0b");
/** Last year / the comparison line: a quiet grey that never competes with the series. */
export const GHOST = "#b8bfbf";
/**
 * Parts that sit side by side (mix tiles, stacked columns, ageing buckets): `n` evenly spaced steps of the one blue ramp,
 * darkest first, so neighbouring parts read as one family instead of a row of unrelated hues. Names and amounts beside
 * each part carry its identity; the shade only orders them.
 */
export function ramp(n: number): string[] {
  const top = SEQ.length - 1;
  const k = Math.max(1, Math.min(n, SEQ.length));
  // Up to 6 parts skip the near-white step, so the lightest part still shows on a white card.
  const low = k < SEQ.length ? 1 : 0;
  const out = Array.from({ length: k }, (_, i) => SEQ[k === 1 ? top : Math.round(top - (i * (top - low)) / (k - 1))]);
  return n > SEQ.length ? [...out, ...Array.from({ length: n - SEQ.length }, () => SEQ[0])] : out;
}
/** Label ink on a ramp step: white on the dark steps, near-black on the light ones (each pair at least 4.5:1). */
export const rampInk = (c: string) => seqInk(SEQ.indexOf(c as (typeof SEQ)[number]));

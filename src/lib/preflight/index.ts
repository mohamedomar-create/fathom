// Spreadsheet preflight: checks an upload for one import before anything is imported, guides the fixes, and builds
// the cleaned copy. Pure (runs in the upload worker and on the server).
export { inspectWorkbook, rulesFor, colLetter } from "./inspect";
export { cleanWorkbook, beforeAfter, type CleanChange, type Cleaned, type Rejected } from "./clean";
export { toCsv, toXlsx, supportedFile } from "./export";
export { runPreflight, type PreflightRun } from "./run";
export type { Decisions, FixKind, IssueCode, PreflightColumn, PreflightIssue, PreflightModule, PreflightReport, SheetDecision, SheetReport, SheetStatus } from "./types";

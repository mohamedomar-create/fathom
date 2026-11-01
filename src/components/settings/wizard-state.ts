// The upload wizard's core state: which card, which screen, the chosen files, the sheets read from them, the save
// preview, the error shown and the done message. Every transition is one action here, so each clears exactly what it
// should, the same way every time.
import type { Screen } from "@/components/upload/wizard-shell";

export interface WizardState<K extends string, G, P, F = File> {
  kind: K | null;
  screen: Screen;
  files: F[];
  grids: G[] | null;
  preview: P | null;
  err: string | null;
  done: { what: string } | null;
}

export type WizardAction<K extends string, G, P, F = File> =
  /** A card chosen (or the chooser again): a fresh start, nothing from the last file kept. */
  | { type: "start"; kind: K | null }
  /** The file belongs to another card: switch card, keep the file. */
  | { type: "switch"; kind: K }
  /** Choose another file: back to upload without the file, what was read from it, its preview or its error. */
  | { type: "another" }
  /** Back and Next. */
  | { type: "go"; screen: Screen }
  /** The save preview is ready: the save screen. */
  | { type: "preview"; preview: P }
  /** Saved: the done screen with its message. */
  | { type: "saved"; what: string }
  /** One or more fields on their own (reading progress, errors). */
  | { type: "set"; patch: Partial<Omit<WizardState<K, G, P, F>, "screen" | "kind">> };

export function initialWizard<K extends string, G = unknown, P = unknown, F = File>(kind: K | null): WizardState<K, G, P, F> {
  return { kind, screen: kind ? "get" : "what", files: [], grids: null, preview: null, err: null, done: null };
}

export function wizardReducer<K extends string, G, P, F = File>(s: WizardState<K, G, P, F>, a: WizardAction<K, G, P, F>): WizardState<K, G, P, F> {
  switch (a.type) {
    case "start": return initialWizard<K, G, P, F>(a.kind);
    case "switch": return { ...s, kind: a.kind };
    case "another": return { ...s, screen: "upload", files: [], grids: null, preview: null, err: null };
    case "go": return { ...s, screen: a.screen };
    case "preview": return { ...s, screen: "save", preview: a.preview };
    case "saved": return { ...s, screen: "done", done: { what: a.what }, err: null };
    case "set": return { ...s, ...a.patch };
  }
}

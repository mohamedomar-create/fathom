// The upload wizard's core state (3c): every move between screens goes through one reducer, and each transition clears
// exactly what it should, the same way every time.
import { describe, expect, it } from "vitest";
import { initialWizard, wizardReducer, type WizardState } from "@/components/settings/wizard-state";

type S = WizardState<"accounts" | "sales", string, { p: number }, string>;
const loaded: S = { kind: "sales", screen: "save", files: ["f.xlsx"], grids: ["g"], preview: { p: 1 }, err: "old error", done: { what: "x" } };

describe("upload wizard transitions", () => {
  it("starts on the card chooser, or on 'get the file' when the step is known", () => {
    expect(initialWizard(null)).toEqual({ kind: null, screen: "what", files: [], grids: null, preview: null, err: null, done: null });
    expect(initialWizard("sales").screen).toBe("get");
  });
  it("starting a card is a fresh start: nothing from the last file is kept", () => {
    expect(wizardReducer(loaded, { type: "start", kind: "accounts" })).toEqual({ kind: "accounts", screen: "get", files: [], grids: null, preview: null, err: null, done: null });
    expect(wizardReducer(loaded, { type: "start", kind: null }).screen).toBe("what");
  });
  it("switching card keeps the file (the file was for the other card)", () => {
    const s = wizardReducer(loaded, { type: "switch", kind: "accounts" });
    expect(s).toEqual({ ...loaded, kind: "accounts" });
  });
  it("choosing another file goes back to upload and drops the file, what was read, the preview and the error", () => {
    expect(wizardReducer(loaded, { type: "another" })).toEqual({ ...loaded, screen: "upload", files: [], grids: null, preview: null, err: null });
  });
  it("Back and Next only move between screens", () => {
    expect(wizardReducer(loaded, { type: "go", screen: "check" })).toEqual({ ...loaded, screen: "check" });
  });
  it("saved: the done screen with its message, no error left", () => {
    expect(wizardReducer(loaded, { type: "saved", what: "Saved 3 months." })).toEqual({ ...loaded, screen: "done", done: { what: "Saved 3 months." }, err: null });
  });
  it("a preview opens the save screen", () => {
    expect(wizardReducer({ ...loaded, screen: "check", preview: null }, { type: "preview", preview: { p: 2 } })).toEqual({ ...loaded, screen: "save", preview: { p: 2 } });
  });
  it("single fields can be set on their own", () => {
    expect(wizardReducer(loaded, { type: "set", patch: { err: null, grids: null } })).toEqual({ ...loaded, err: null, grids: null });
  });
});

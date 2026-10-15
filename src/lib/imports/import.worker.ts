/// <reference lib="webworker" />
import { parseFiles, sampleFile } from "./prepare";
import { readWorkbooks } from "@/lib/ingest/read";
import type { WorkerRequest, WorkerResponse } from "./worker-client";

/** Reads uploads off the page's main thread, so the page never freezes on a large export. */
const post = (m: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const m = e.data;
  try {
    if (m.type === "read") {
      post({ id: m.id, type: "read", grids: await readWorkbooks(m.files) });
    } else if (m.type === "sample") {
      const samples = [];
      for (const f of m.files) samples.push(await sampleFile(f.name, f.data, m.saved, f.export ?? null));
      post({ id: m.id, type: "sample", samples });
    } else {
      const result = await parseFiles(m.files, m.opts, (done, of) => post({ id: m.id, type: "progress", done, of }));
      post({ id: m.id, type: "parse", result });
    }
  } catch (err) {
    post({ id: m.id, type: "error", message: (err as Error)?.message || "The file could not be read." });
  }
};

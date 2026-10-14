/**
 * The land build Worker: one `LandJob` in, one `LandReply` out, buffers
 * transferred. Everything it knows is in `land-build.ts`; this file only
 * moves messages. Spawned by `land-build-client.ts` from the hover / settle
 * prefetch (`new Worker(new URL("./land-build.worker.ts", import.meta.url))`).
 */
import { runLandJob, type LandJob, type LandReply } from "./land-build";

const scope = self as unknown as { onmessage: ((e: MessageEvent<LandJob>) => void) | null; postMessage(message: LandReply, transfer?: Transferable[]): void };

scope.onmessage = (event: MessageEvent<LandJob>) => {
  const job = event.data;
  const t0 = performance.now();
  try {
    const { result, transfer } = runLandJob(job);
    scope.postMessage({ id: job.id, ok: true, result, ms: performance.now() - t0 }, transfer);
  } catch (error) {
    scope.postMessage({ id: job.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
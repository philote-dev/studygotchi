/**
 * Stage events: what a layer asks the product to do, without the layer
 * knowing routes or stores. A layer emits; the shell (which has the router)
 * listens. Module listeners first; the same event is also dispatched on
 * `window` as a `CustomEvent` of the same name with the event as `detail`,
 * so code that cannot import this module (or a Playwright probe) can watch.
 *
 *   stage:open-course-constellation  a course's cluster / bead was clicked
 *                                    in the galaxy: open that course's
 *                                    constellation (the Information page).
 */

export interface OpenCourseConstellationEvent {
  type: "stage:open-course-constellation";
  courseId: string;
  /** What asked: the galaxy bead (S3-4); later the cluster graph or a keyboard path. */
  source: "bead-click";
}

export type StageEvent = OpenCourseConstellationEvent;
export type StageEventType = StageEvent["type"];
export type StageEventOf<T extends StageEventType> = Extract<StageEvent, { type: T }>;

type Listener<T extends StageEventType> = (event: StageEventOf<T>) => void;

const listeners = new Map<StageEventType, Set<Listener<StageEventType>>>();

export function onStageEvent<T extends StageEventType>(type: T, fn: Listener<T>): () => void {
  let set = listeners.get(type);
  if (!set) {
    set = new Set();
    listeners.set(type, set);
  }
  const entry = fn as unknown as Listener<StageEventType>;
  set.add(entry);
  return () => {
    set.delete(entry);
  };
}

/** Deliver to module listeners (in subscription order), then to `window`. Returns how many module listeners ran. */
export function emitStageEvent(event: StageEvent): number {
  const set = listeners.get(event.type);
  let delivered = 0;
  if (set) {
    for (const fn of [...set]) {
      fn(event);
      delivered++;
    }
  }
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent(event.type, { detail: event }));
    } catch {
      // A window without CustomEvent (old jsdom): module listeners already ran.
    }
  }
  return delivered;
}

export function openCourseConstellation(courseId: string, source: OpenCourseConstellationEvent["source"] = "bead-click"): number {
  return emitStageEvent({ type: "stage:open-course-constellation", courseId, source });
}

/** Tests: drop every listener. */
export function resetStageEvents(): void {
  listeners.clear();
}

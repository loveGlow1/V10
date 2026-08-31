/* What the server actually did, in the order it did it.
 *
 * A workspace that says "Generating the page" for forty seconds is describing
 * the wait, not the work. The route already knows far more than that — which
 * classifier answered and how sure it was, how many patch blocks landed, what
 * the model call cost, whether the row was written — and every bit of it was
 * being thrown away when the response was assembled.
 *
 * So each operation is recorded as it happens, with the milliseconds it took,
 * and the list rides back with the reply. Nothing here is inferred by the
 * browser and nothing is a placeholder: a step exists because a thing was done.
 *
 * The shape matches the tracker's own ActivityStep, so the panel renders these
 * directly rather than translating them into a second vocabulary that would
 * drift from this one. */

export type BuildStep = {
  id: string;
  label: string;
  /** The concrete result — a count, a model name, a cost. */
  detail?: string;
  /** How long it really took. */
  ms?: number;
  state: "done" | "running" | "pending";
};

/* A stopwatch that laps. Each mark closes the operation that just ran and opens
   the next, so the durations are contiguous and add up to the request rather
   than leaving gaps where time went unaccounted for. */
export function stepRecorder() {
  const steps: BuildStep[] = [];
  let lap = Date.now();

  return {
    mark(id: string, label: string, detail?: string) {
      const now = Date.now();
      steps.push({ id, label, detail, ms: now - lap, state: "done" });
      lap = now;
    },
    /** For work this route hands off and does not wait for. */
    running(id: string, label: string, detail?: string) {
      steps.push({ id, label, detail, state: "running" });
    },
    list(): BuildStep[] {
      return steps;
    },
  };
}

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

/** Where a step goes the moment it happens. See stepRecorder. */
export type StepSink = (step: BuildStep) => void;

/* A stopwatch that laps, wired to a sink.
 *
 * Each mark closes the operation that just ran and opens the next, so the
 * durations are contiguous and add up to the request rather than leaving gaps
 * where time went unaccounted for.
 *
 * The sink is the difference between a record and a broadcast. The list still
 * rides back with the reply, because a finished message keeps its timeline, but
 * every step also goes out the moment it is known — so the panel fills in while
 * the work happens instead of all at once when it is over. A request that takes
 * forty seconds and says nothing for thirty-nine of them is indistinguishable
 * from one that has hung.
 *
 * `begin` is what makes it live rather than merely early. `mark` can only fire
 * once an operation has finished, so a recorder with nothing but marks streams
 * a list of things already done and stays silent through the slow part, which
 * is exactly the part someone is watching. `begin` announces the operation
 * before it runs; `mark` with the same id closes it, and the panel merges the
 * two by that id into one row that ticks over. */
export function stepRecorder(onStep: StepSink = () => {}) {
  const steps: BuildStep[] = [];
  let lap = Date.now();

  return {
    /**
     * Announces an operation that is about to run.
     *
     * Streamed but not stored: the stored step is the finished one `mark`
     * pushes, and keeping both would leave the timeline with two rows for one
     * operation. A `begin` whose `mark` never comes — the request died in the
     * middle of it — is the one case where that costs something, and the
     * running row left on screen is the correct account of what happened.
     */
    begin(id: string, label: string, detail?: string) {
      onStep({ id, label, detail, state: "running" });
    },
    mark(id: string, label: string, detail?: string) {
      const now = Date.now();
      const step: BuildStep = { id, label, detail, ms: now - lap, state: "done" };
      steps.push(step);
      lap = now;
      onStep(step);
    },
    /** For work this route hands off and does not wait for. */
    running(id: string, label: string, detail?: string) {
      const step: BuildStep = { id, label, detail, state: "running" };
      steps.push(step);
      onStep(step);
    },
    list(): BuildStep[] {
      return steps;
    },
  };
}

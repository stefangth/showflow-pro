/**
 * Wraps an async `run` function with single-flight + trailing-rerun semantics:
 * calling the returned trigger while a cycle from a previous call is still in
 * flight does NOT start a second, concurrent cycle. It only flags that a
 * rerun is needed. The moment the in-flight cycle's promise settles, exactly
 * one trailing rerun fires (coalescing any number of triggers received during
 * the flight into that single rerun) and calls `run` again.
 *
 * This is what guarantees write ordering for the debounced live-preview cycle
 * below: `run` is never invoked a second time until the previous invocation's
 * promise has fully settled, so two cycles can never race. Whichever DB write
 * (and preview) `run` performs on its Nth call is always fully committed
 * before its (N+1)th call begins, so a superseded edit's write/preview can
 * never land after a newer edit's.
 *
 * A pure post-await "generation" check alone cannot give this guarantee: by
 * the time such a check could run (after the stale cycle's own `await`), the
 * stale cycle's write has already been sent, so it can still resolve after a
 * newer cycle's write and clobber it. Serializing the calls, as this does, is
 * the only way to guarantee ordering.
 *
 * Exported for direct unit testing. This primitive has no timing of its own;
 * the 800ms debounce lives in HireOrderEditPage's autosave effect.
 */
export function createSingleFlightRunner(run: () => Promise<void>): () => void {
  let inFlight = false;
  let rerunPending = false;

  async function loop() {
    inFlight = true;
    try {
      do {
        rerunPending = false;
        await run();
      } while (rerunPending);
    } finally {
      inFlight = false;
    }
  }

  return () => {
    if (inFlight) {
      rerunPending = true;
      return;
    }
    void loop();
  };
}

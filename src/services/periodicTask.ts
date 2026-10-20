/** Stop scheduling immediately, then let the in-flight run finish before disconnecting DB. */
export function schedulePeriodicTask(
  work: () => Promise<unknown>,
  intervalMs: number,
  onError: (error: unknown) => void,
): () => Promise<void> {
  let stopped = false;
  let active: Promise<void> | undefined;
  const run = () => {
    if (stopped || active) return;
    active = Promise.resolve().then(work).then(() => undefined).catch(onError)
      .finally(() => { active = undefined; });
  };
  const timer = setInterval(run, intervalMs);
  run();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await active;
  };
}

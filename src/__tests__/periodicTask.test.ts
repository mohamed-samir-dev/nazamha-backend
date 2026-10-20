import { schedulePeriodicTask } from "../services/periodicTask";

afterEach(() => jest.useRealTimers());

test("shutdown drains the active job, prevents overlapping runs, and never restarts", async () => {
  jest.useFakeTimers();
  let release!: () => void;
  const work = jest.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const stop = schedulePeriodicTask(work, 100, jest.fn());
  await jest.advanceTimersByTimeAsync(1000);
  expect(work).toHaveBeenCalledTimes(1);
  let drained = false;
  const stopping = stop().then(() => { drained = true; });
  await jest.advanceTimersByTimeAsync(1000);
  expect(drained).toBe(false);
  release();
  await stopping;
  await stop();
  await jest.advanceTimersByTimeAsync(1000);
  expect(work).toHaveBeenCalledTimes(1);
  expect(drained).toBe(true);
});

test("a failed run is reported and the next scheduled run can recover", async () => {
  jest.useFakeTimers();
  const failure = new Error("database unavailable");
  const work = jest.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
  const onError = jest.fn();
  const stop = schedulePeriodicTask(work, 100, onError);
  await jest.advanceTimersByTimeAsync(100);
  expect(onError).toHaveBeenCalledWith(failure);
  expect(work).toHaveBeenCalledTimes(2);
  await stop();
});

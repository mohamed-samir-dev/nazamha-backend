import { OperationCounter } from "../models/OperationCounter";
import { reserveSequence } from "../services/counters";

afterEach(() => jest.restoreAllMocks());

test("existing counter reserves a block in one database call", async () => {
  const initial = jest.fn();
  const reserve = jest.spyOn(OperationCounter.collection, "findOneAndUpdate").mockResolvedValue({ value: 13 } as any);
  const read = jest.spyOn(OperationCounter.collection, "findOne");
  expect(await reserveSequence("test", 3, initial)).toBe(11);
  expect(reserve).toHaveBeenCalledTimes(1);
  expect(initial).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});

test("missing counter initializes from existing records then reserves", async () => {
  const reserve = jest.spyOn(OperationCounter.collection, "findOneAndUpdate")
    .mockResolvedValueOnce(null as any).mockResolvedValueOnce({ value: 9 } as any);
  const initialize = jest.spyOn(OperationCounter.collection, "updateOne").mockResolvedValue({} as any);
  expect(await reserveSequence("test", 2, async () => 7)).toBe(8);
  expect(initialize).toHaveBeenCalledWith({ _id: "test" }, { $setOnInsert: { value: 7 } }, { upsert: true });
  expect(reserve).toHaveBeenCalledTimes(2);
});

test("concurrent initialization losing the unique-key race still reserves its own block", async () => {
  jest.spyOn(OperationCounter.collection, "findOneAndUpdate")
    .mockResolvedValueOnce(null as any).mockResolvedValueOnce({ value: 12 } as any);
  jest.spyOn(OperationCounter.collection, "updateOne").mockRejectedValue({ code: 11000 });
  expect(await reserveSequence("test", 2, async () => 7)).toBe(11);
});

import "dotenv/config";
import { connectDB, disconnectDB } from "../config/db";
import { scheduleAutoAbsent } from "./autoAbsent";
import { scheduleRecurringGeneration } from "../utils/recurringCron";

async function start() {
  await connectDB();
  const stopAbsent = scheduleAutoAbsent();
  const stopRecurring = scheduleRecurringGeneration();
  const stop = async () => {
    stopAbsent(); stopRecurring();
    await disconnectDB();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
start().catch(error => { console.error("[worker] startup failed", error); process.exitCode = 1; });

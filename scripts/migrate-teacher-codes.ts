import "dotenv/config";
import mongoose from "mongoose";
import { backfillTeacherCodes } from "../src/services/teacherCodeMigration";
import { Teacher } from "../src/models/Teacher";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("❌ MONGODB_URI is not defined in environment variables.");
    process.exit(1);
  }

  console.log("🔌 Connecting to MongoDB...");
  await mongoose.connect(uri);
  console.log("✅ Connected.");

  console.log("🚀 Starting Teacher Code backfill migration...");
  const report = await backfillTeacherCodes({ model: Teacher, log: true });

  console.log("✨ Ensuring unique index on teacherCode...");
  await Teacher.collection.createIndex({ teacherCode: 1 }, { unique: true });
  console.log("✅ Unique index verified on teacherCode.");

  await mongoose.disconnect();
  console.log("🔌 Disconnected from MongoDB. Migration completed successfully.");
  process.exit(report.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("❌ Migration failed with unhandled error:", err);
  process.exit(1);
});

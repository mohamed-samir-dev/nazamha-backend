import "dotenv/config";
import mongoose from "mongoose";

async function fixGroupIndex() {
  await mongoose.connect(process.env.MONGODB_URI!);
  const col = mongoose.connection.collection("groups");
  try {
    await col.dropIndex("code_1");
    console.log("✅ Dropped old code_1 index");
  } catch {
    console.log("ℹ️ Index not found, skipping drop");
  }
  await col.createIndex({ code: 1 }, { unique: true, sparse: true });
  console.log("✅ Created new sparse unique index on code");
  await mongoose.disconnect();
}

fixGroupIndex().catch((err) => { console.error(err); process.exit(1); });

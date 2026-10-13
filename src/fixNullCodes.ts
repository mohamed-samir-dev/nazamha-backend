import "dotenv/config";
import mongoose from "mongoose";

async function fixNullCodes() {
  await mongoose.connect(process.env.MONGODB_URI!, { autoIndex: false });
  const col = mongoose.connection.collection("groups");
  const result = await col.updateMany({ code: null }, { $unset: { code: "" } });
  console.log(`✅ Unset code from ${result.modifiedCount} groups`);
  await mongoose.disconnect();
}

fixNullCodes().catch((err) => { console.error(err); process.exit(1); });

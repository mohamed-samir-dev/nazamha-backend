import "dotenv/config";
import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import { Group } from "./models/Group";

const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../groub.json"), "utf-8"));
const groups = data.groups;

async function seedGroups() {
  await mongoose.connect(process.env.MONGODB_URI!, { autoIndex: false });
  console.log("✅ Connected to MongoDB");

  const col = mongoose.connection.collection("groups");
  try { await col.dropIndex("code_1"); } catch {}
  await col.createIndex({ code: 1 }, { unique: true, sparse: true });

  let created = 0;
  for (const g of groups) {
    const exists = await Group.findOne({ name: g.name, teacher_id: g.teacher_id });
    if (!exists) {
      await Group.create({
        ...g,
        teacher_id: new mongoose.Types.ObjectId(g.teacher_id),
        sub_teacher_id: g.sub_teacher_id ?? null,
        created_at: g.created_at ? new Date(g.created_at) : undefined,
      });
      created++;
      console.log(`✅ Created: ${g.name}`);
    } else {
      console.log(`⏭️  Already exists: ${g.name}`);
    }
  }

  console.log(`\n✅ Done — ${created} groups created, ${groups.length - created} already existed.`);
  await mongoose.disconnect();
}

seedGroups().catch((err) => { console.error(err); process.exit(1); });

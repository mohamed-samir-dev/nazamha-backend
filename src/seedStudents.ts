import "dotenv/config";
import mongoose from "mongoose";
import { Teacher } from "./models/Teacher";
import { Group } from "./models/Group";
import { Student } from "./models/Student";

const firstNames = [
  "أحمد","محمد","علي","عمر","يوسف","إبراهيم","خالد","كريم","مصطفى","طارق",
  "سامي","وليد","هاني","ماجد","فادي","رامي","نادر","زياد","باسم","حسام",
  "فاطمة","مريم","نور","سارة","هنا","دينا","رنا","ياسمين","منى","هبة",
  "آية","شيماء","نهى","ريم","لمى","سلمى","دعاء","إيمان","أسماء","رشا",
];

const lastNames = [
  "محمود","حسن","إبراهيم","عبدالله","السيد","علي","عمر","خليل","سالم","جمال",
  "فوزي","رضا","منصور","عطية","زكي","حسين","شاكر","نصر","بدر","طه",
];

function randomName() {
  const f = firstNames[Math.floor(Math.random() * firstNames.length)];
  const l = lastNames[Math.floor(Math.random() * lastNames.length)];
  return `${f} ${l}`;
}

function randomPhone() {
  const prefixes = ["010","011","012","015"];
  const p = prefixes[Math.floor(Math.random() * prefixes.length)];
  return p + String(Math.floor(Math.random() * 90000000) + 10000000);
}

async function seedStudents() {
  await mongoose.connect(process.env.MONGODB_URI!);
  console.log("✅ Connected to MongoDB");

  const teacher = await Teacher.findById("6a6b982dffe64d19e7bd7cb6");
  if (!teacher) {
    console.error("❌ Teacher not found.");
    process.exit(1);
  }

  const groups = await Group.find({ teacher_id: teacher._id });
  if (!groups.length) {
    console.error("❌ No groups found. Run seedGroups first.");
    process.exit(1);
  }

  const TOTAL = 600;
  const perGroup = Math.floor(TOTAL / groups.length);   // 60 per group
  const remainder = TOTAL % groups.length;              // leftover goes to first group

  let created = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const count = perGroup + (gi === 0 ? remainder : 0);
    const docs = Array.from({ length: count }, (_, i) => ({
      name: randomName(),
      code: `STU-${String(gi + 1).padStart(2, "0")}-${String(i + 1).padStart(3, "0")}`,
      group_id: group._id,
      teacher_id: teacher._id,
      parent_phone: randomPhone(),
    }));
    await Student.insertMany(docs);
    created += count;
    console.log(`  ✔ ${count} students → ${group.name}`);
  }

  console.log(`\n✅ Done — ${created} students created across ${groups.length} groups.`);
  await mongoose.disconnect();
}

seedStudents().catch((err) => { console.error(err); process.exit(1); });

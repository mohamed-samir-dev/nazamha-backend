import "dotenv/config";
import mongoose from "mongoose";
import { Group } from "./models/Group";
import { Student } from "./models/Student";
import { Grade } from "./models/Grade";
import { MonthlySubscription } from "./models/MonthlySubscription";

const TEACHER_ID = "6a69020ee37cd7f2a1917065";

// ── بيانات المجموعات ────────────────────────────────────────────────────────
const groupsData = [
  { name: "الصف الأول أ",     day_of_week: "السبت",    time: "08:00", monthly_price: 200 },
  { name: "الصف الأول ب",     day_of_week: "الأحد",    time: "09:00", monthly_price: 200 },
  { name: "الصف الثاني أ",    day_of_week: "الاثنين",  time: "08:00", monthly_price: 220 },
  { name: "الصف الثاني ب",    day_of_week: "الثلاثاء", time: "09:00", monthly_price: 220 },
  { name: "الصف الثالث أ",    day_of_week: "الأربعاء", time: "10:00", monthly_price: 250 },
  { name: "الصف الثالث ب",    day_of_week: "الخميس",   time: "10:00", monthly_price: 250 },
  { name: "الصف الرابع أ",    day_of_week: "السبت",    time: "11:00", monthly_price: 270 },
  { name: "الصف الرابع ب",    day_of_week: "الأحد",    time: "12:00", monthly_price: 270 },
  { name: "الصف الخامس أ",    day_of_week: "الاثنين",  time: "11:00", monthly_price: 290 },
  { name: "الصف الخامس ب",    day_of_week: "الثلاثاء", time: "12:00", monthly_price: 290 },
  { name: "الصف السادس أ",    day_of_week: "الأربعاء", time: "13:00", monthly_price: 300 },
  { name: "الصف السادس ب",    day_of_week: "الخميس",   time: "13:00", monthly_price: 300 },
  { name: "الصف السابع أ",    day_of_week: "الجمعة",   time: "09:00", monthly_price: 320 },
  { name: "الصف السابع ب",    day_of_week: "السبت",    time: "14:00", monthly_price: 320 },
  { name: "الصف الثامن أ",    day_of_week: "الأحد",    time: "14:00", monthly_price: 350 },
  { name: "الصف الثامن ب",    day_of_week: "الاثنين",  time: "15:00", monthly_price: 350 },
  { name: "الصف التاسع أ",    day_of_week: "الثلاثاء", time: "15:00", monthly_price: 370 },
  { name: "الصف التاسع ب",    day_of_week: "الأربعاء", time: "16:00", monthly_price: 370 },
  { name: "مجموعة المتفوقين", day_of_week: "الخميس",   time: "16:00", monthly_price: 400 },
  { name: "مجموعة خاصة",      day_of_week: "الجمعة",   time: "11:00", monthly_price: 500, is_private: true },
];

// ── مكونات الأسماء الرباعية ─────────────────────────────────────────────────
const firstNames = [
  "أحمد","محمد","علي","عمر","يوسف","إبراهيم","خالد","كريم","مصطفى","طارق",
  "سامي","وليد","هاني","ماجد","فادي","رامي","نادر","زياد","باسم","حسام",
  "فاطمة","مريم","نور","سارة","هنا","دينا","رنا","ياسمين","منى","هبة",
  "آية","شيماء","نهى","ريم","لمى","سلمى","دعاء","إيمان","أسماء","رشا",
];

const midNames = [
  "عبدالله","عبدالرحمن","عبدالعزيز","عبدالحميد","عبدالكريم",
  "محمود","حسن","حسين","جمال","كمال","سعيد","فتحي","رمضان","صلاح","عادل",
  "مجدي","سمير","نبيل","وجدي","شريف","طلعت","عصام","هشام","أيمن","ممدوح",
];

const grandNames = [
  "السيد","البدوي","الشافعي","الحنفي","الأزهري","الغزالي","الرفاعي",
  "القاضي","الشيخ","الأمير","الحاج","الدسوقي","الجوهري","الصاوي","الليثي",
];

const familyNames = [
  "محمود","حسن","إبراهيم","عبدالله","السيد","علي","عمر","خليل","سالم","جمال",
  "فوزي","رضا","منصور","عطية","زكي","حسين","شاكر","نصر","بدر","طه",
  "عوض","غنيم","درويش","قاسم","صالح","مرسي","عفيفي","حلمي","بهاء","سلامة",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// أسماء رباعية فريدة بدون تكرار
const usedNames = new Set<string>();
function uniqueFullName(): string {
  let name: string;
  let tries = 0;
  do {
    name = `${pick(firstNames)} ${pick(midNames)} ${pick(grandNames)} ${pick(familyNames)}`;
    tries++;
  } while (usedNames.has(name) && tries < 200);
  usedNames.add(name);
  return name;
}

function randomPhone(): string {
  const prefixes = ["010","011","012","015"];
  return pick(prefixes) + String(Math.floor(Math.random() * 90000000) + 10000000);
}

// ── تاريخ الاشتراك: بداية العام الدراسي (سبتمبر 2024) ──────────────────────
const SUB_START_MONTH = 9;   // سبتمبر
const SUB_START_YEAR  = 2024;

// الشهر الحالي لإنشاء سجل اشتراك
const NOW   = new Date();
const CUR_M = NOW.getMonth() + 1;
const CUR_Y = NOW.getFullYear();

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);
  console.log("✅ Connected to MongoDB");

  const teacherId = new mongoose.Types.ObjectId(TEACHER_ID);

  // ── 1. حذف البيانات القديمة للأستاذ دا ─────────────────────────────────
  const oldGroups = await Group.find({ teacher_id: teacherId }).select("_id");
  const oldGroupIds = oldGroups.map((g) => g._id);
  const oldStudents = await Student.find({ teacher_id: teacherId }).select("_id");
  const oldStudentIds = oldStudents.map((s) => s._id);

  await MonthlySubscription.deleteMany({ teacher_id: teacherId });
  await Student.deleteMany({ teacher_id: teacherId });
  await Group.deleteMany({ teacher_id: teacherId });
  console.log(`🗑  Cleared ${oldGroupIds.length} groups, ${oldStudentIds.length} students, subscriptions.`);

  // ── 2. إنشاء أو جلب Grade "ثالثة ثانوي" ────────────────────────────────
  let grade = await Grade.findOne({ name: "ثالثة ثانوي", teacher_id: teacherId });
  if (!grade) {
    grade = await Grade.create({ name: "ثالثة ثانوي", teacher_id: teacherId, monthly_price: null });
    console.log("✅ Grade 'ثالثة ثانوي' created.");
  } else {
    console.log("ℹ️  Grade 'ثالثة ثانوي' already exists.");
  }
  const gradeId = grade._id as mongoose.Types.ObjectId;

  // ── 3. إنشاء المجموعات ──────────────────────────────────────────────────
  const createdGroups: { id: mongoose.Types.ObjectId; price: number }[] = [];
  for (const g of groupsData) {
    const group = await Group.create({
      ...g,
      sessions_per_month: 4,
      teacher_id: teacherId,
    });
    createdGroups.push({ id: group._id as mongoose.Types.ObjectId, price: g.monthly_price });
  }
  console.log(`✅ ${createdGroups.length} groups created.`);

  // ── 4. إنشاء الطلاب وتوزيعهم ────────────────────────────────────────────
  const TOTAL    = 500;
  const perGroup = Math.floor(TOTAL / createdGroups.length); // 25
  const extra    = TOTAL % createdGroups.length;             // باقي للمجموعة الأولى

  let totalStudents = 0;
  const subscriptionDocs: object[] = [];

  for (let gi = 0; gi < createdGroups.length; gi++) {
    const { id: groupId, price } = createdGroups[gi];
    const count = perGroup + (gi === 0 ? extra : 0);

    const studentDocs = Array.from({ length: count }, (_, i) => ({
      name: uniqueFullName(),
      code: `STU-${String(gi + 1).padStart(2, "0")}-${String(i + 1).padStart(3, "0")}`,
      group_id: groupId,
      grade_id: gradeId,
      teacher_id: teacherId,
      parent_phone: randomPhone(),
      subscription_start_month: SUB_START_MONTH,
      subscription_start_year:  SUB_START_YEAR,
    }));

    const inserted = await Student.insertMany(studentDocs);
    totalStudents += inserted.length;

    // سجل اشتراك الشهر الحالي لكل طالب
    for (const s of inserted) {
      subscriptionDocs.push({
        student_id: s._id,
        teacher_id: teacherId,
        month:  CUR_M,
        year:   CUR_Y,
        status: "due",
        amount: price,
        discount: 0,
      });
    }

    console.log(`  ✔ ${count} students → ${groupsData[gi].name}`);
  }

  // ── 5. إدراج سجلات الاشتراك دفعة واحدة ─────────────────────────────────
  await MonthlySubscription.insertMany(subscriptionDocs);
  console.log(`\n✅ Done — ${totalStudents} students, ${subscriptionDocs.length} subscription records.`);

  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });

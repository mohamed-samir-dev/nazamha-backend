import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import { Student } from "./models/Student";
import { Group } from "./models/Group";
import { Teacher } from "./models/Teacher";
import { MonthlySubscription } from "./models/MonthlySubscription";

async function run() {
  await mongoose.connect(process.env.MONGODB_URI!);
  console.log("✅ Connected");

  const students = await Student.find({}).lean();
  let fixed = 0;

  for (const student of students) {
    const s = student as any;

    let basePrice = s.custom_monthly_price || 0;
    if (!basePrice && s.group_id) {
      const group = await Group.findById(s.group_id).lean();
      basePrice = (group as any)?.monthly_price || 0;
    }
    if (!basePrice) {
      const teacher = await Teacher.findById(s.teacher_id).lean();
      basePrice = (teacher as any)?.monthly_price || 0;
    }
    if (!basePrice) continue;

    const familyPct = s.family_discount_percent ?? 0;
    const individualPct = Number(s.discount_value) || 0;
    const activePct = familyPct > 0 ? familyPct : individualPct;
    const netPrice = activePct > 0 ? Math.round(basePrice * (1 - activePct / 100)) : basePrice;
    const discountAmt = basePrice - netPrice;

    // صلح كل الاشتراكات (due و paid) اللي amount بتاعها غلط
    const result = await MonthlySubscription.updateMany(
      { student_id: s._id, status: { $in: ["due", "paid"] }, amount: { $ne: basePrice } },
      { amount: basePrice, discount: discountAmt }
    );
    if (result.modifiedCount > 0) {
      console.log(`✔ ${s.name} — سعر: ${basePrice} ج، خصم: ${discountAmt} ج، صافي: ${netPrice} ج (${result.modifiedCount} اشتراك)`);
      fixed += result.modifiedCount;
    }
  }

  console.log(`\n✅ تم تصحيح ${fixed} اشتراك`);
  await mongoose.disconnect();
}

run().catch((e) => { console.error(e); process.exit(1); });

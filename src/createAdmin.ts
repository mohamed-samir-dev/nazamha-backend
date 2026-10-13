import "dotenv/config";
import mongoose from "mongoose";
import { Admin } from "./models/Admin";

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);

  const name = "محمد سمير";
  const email = "mohamed.samir@admin.com";
  const password = "Admin@123456";

  const existing = await Admin.findOne({ email });
  if (existing) {
    console.log("✅ الأدمن موجود بالفعل:", email);
    await mongoose.disconnect();
    return;
  }

  await Admin.create({
    name,
    email,
    password,
    is_super_admin: true,
    is_active: true,
  });

  console.log("✅ تم إنشاء السوبر أدمن بنجاح!");
  console.log("   الاسم    :", name);
  console.log("   الإيميل  :", email);
  console.log("   كلمة السر:", password);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("❌ خطأ:", err);
  process.exit(1);
});

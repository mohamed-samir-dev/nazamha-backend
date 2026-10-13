import "dotenv/config";
import mongoose from "mongoose";
import { Admin } from "./models/Admin";

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);

  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const name = process.env.SUPER_ADMIN_NAME || "Super Admin";

  if (!email || !password) {
    console.error("❌ SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set in .env");
    process.exit(1);
  }

  const existing = await Admin.findOne({ email });
  if (existing) {
    console.log("✅ Super admin already exists:", email);
    await mongoose.disconnect();
    return;
  }

  await Admin.create({ name, email, password, is_super_admin: true, is_active: true });
  console.log("✅ Super admin created:", email);

  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });

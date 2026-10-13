import "dotenv/config";
import mongoose from "mongoose";
import { Teacher } from "./models/Teacher";

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);

  const email = "teacher@test.com";
  const password = "Teacher@123456";

  const existing = await Teacher.findOne({ email });
  if (existing) {
    // Reset password and activate
    existing.password = password;
    existing.is_active = true;
    existing.failed_login_attempts = 0;
    await existing.save();
    console.log("✅ Teacher updated — password reset & activated:", email);
  } else {
    await Teacher.create({ name: "Test Teacher", email, password, is_active: true });
    console.log("✅ Teacher created:");
    console.log("   Email   :", email);
    console.log("   Password:", password);
  }

  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });

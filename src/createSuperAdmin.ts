import "dotenv/config";
import mongoose from "mongoose";
import { Admin } from "./models/Admin";
import crypto from "crypto";

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);

  console.log("🗑️  Deleting all existing admins...");
  const deleteResult = await Admin.deleteMany({});
  console.log(`✅ Deleted ${deleteResult.deletedCount} admin(s)`);

  // Generate random credentials
  const randomId = crypto.randomBytes(4).toString("hex");
  const email = `admin_${randomId}@nazamha.app`;
  const password = crypto.randomBytes(12).toString("base64url"); // URL-safe random password
  const name = "Super Admin";

  await Admin.create({ 
    name, 
    email, 
    password, 
    is_super_admin: true, 
    is_active: true 
  });

  console.log("\n✅ Super admin created successfully!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📧 Email:    ", email);
  console.log("🔑 Password: ", password);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\n⚠️  Save these credentials - they won't be shown again!\n");

  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });

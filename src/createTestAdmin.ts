import "dotenv/config";
import mongoose from "mongoose";
import { Admin } from "./models/Admin";

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);

  const email = "testadmin@nazamha.com";
  const password = "Admin@123456";
  const name = "Test Super Admin";

  // Delete if exists
  await Admin.deleteMany({ email });

  // Create new
  await Admin.create({ 
    name, 
    email, 
    password, 
    is_super_admin: true, 
    is_active: true 
  });
  
  console.log("✅ Test admin created:", email, "/ Password:", password);

  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });

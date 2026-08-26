import bcrypt from "bcryptjs";
import db from "./config/db.js";

async function seedAdmin() {
  const name = "Admin";
  const email = "admin@nutriexa.com";
  const plainPassword = "admin123";
  const role = "Super Admin";

  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  try {
    await db.query(
      "INSERT INTO admins (name, email, password, role) VALUES (?, ?, ?, ?)",
      [name, email, hashedPassword, role]
    );
    console.log("✅ Admin created successfully!");
    console.log("Email:", email);
    console.log("Password:", plainPassword);
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
  process.exit();
}

seedAdmin();
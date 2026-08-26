import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import userRoutes from "./routes/userRoutes.js";
import adminCustomerRoutes from "./routes/adminCustomerRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import couponRoutes from "./routes/couponRoutes.js";
import authenticatorRoutes from "./routes/authenticatorRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import productRoutes from "./routes/productRoutes.js";

import paymentRoutes from "./routes/paymentRoutes.js";

import db from "./config/db.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json());

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/admin", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin/customers", adminCustomerRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin/dashboard", dashboardRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/authenticator", authenticatorRoutes);
app.use("/api/payment", paymentRoutes);

app.get("/", (req, res) => {
  res.send("Nutriexa Backend Running ✅");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);

  try {
    const result = await db.pool.query("SELECT NOW()");
    console.log("✅ Supabase PostgreSQL connected");
    console.log("🕐 Database time:", result.rows[0].now);

    // Auto-migrate missing columns and tables if needed
    await db.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
      ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS otp VARCHAR(10),
      ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMP;

      ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

      ALTER TABLE orders 
      ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'Pending',
      ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS shipping_phone VARCHAR(50),
      ADD COLUMN IF NOT EXISTS shipping_address TEXT,
      ADD COLUMN IF NOT EXISTS shipping_city VARCHAR(100),
      ADD COLUMN IF NOT EXISTS shipping_state VARCHAR(100),
      ADD COLUMN IF NOT EXISTS shipping_pincode VARCHAR(20);

      CREATE TABLE IF NOT EXISTS user_addresses (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255),
        phone VARCHAR(50),
        address_line1 TEXT,
        address_line2 TEXT,
        city VARCHAR(100),
        state VARCHAR(100),
        pincode VARCHAR(20),
        address_type VARCHAR(50) DEFAULT 'Home',
        is_default BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
  } catch (error) {
    console.error("❌ Supabase PostgreSQL connection/migration failed:");
    console.error("Message:", error.message);
  }
});
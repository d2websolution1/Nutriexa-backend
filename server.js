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
import staffRoutes from "./routes/staffRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";

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
app.use("/api/admin/staff", staffRoutes);
app.use("/api/categories", categoryRoutes);
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
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(100) DEFAULT 'Staff',
        permissions TEXT DEFAULT '[]',
        is_active BOOLEAN DEFAULT TRUE,
        phone VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      ALTER TABLE admins 
      ADD COLUMN IF NOT EXISTS role VARCHAR(100) DEFAULT 'Staff',
      ADD COLUMN IF NOT EXISTS permissions TEXT DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

      -- Ensure existing super admin accounts have proper role and wildcard permissions
      UPDATE admins 
      SET role = 'Super Admin', permissions = '["*"]' 
      WHERE (role IS NULL OR role = 'Super Admin' OR role = 'admin' OR email = 'admin@nutriexa.com') 
        AND (permissions IS NULL OR permissions = '[]' OR permissions = '' OR permissions = 'null');

      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
      ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS otp VARCHAR(10),
      ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMP;

      ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS images TEXT,
      ADD COLUMN IF NOT EXISTS sku VARCHAR(100);

      UPDATE products 
      SET sku = 'NX-' || UPPER(SUBSTRING(COALESCE(category, 'PRD') FROM 1 FOR 4)) || '-' || LPAD(id::text, 4, '0') 
      WHERE sku IS NULL OR sku = '';

      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        image TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Seed default categories if none exist
      INSERT INTO categories (name, slug, description, is_active)
      VALUES
        ('Whey Proteins', 'whey-proteins', 'Premium whey isolate and concentrate blends for lean muscle growth.', TRUE),
        ('Mass Gainers', 'mass-gainers', 'High calorie mass gain formulas rich in protein and complex carbs.', TRUE),
        ('Pre-Workouts', 'pre-workouts', 'Explosive energy and pump formulas for intense workout sessions.', TRUE),
        ('Amino Acids & BCAA', 'amino-acids', 'Fast absorbing BCAAs and EAAs for speedy muscle recovery.', TRUE),
        ('Health & Wellness', 'health-wellness', 'Essential vitamins, fish oil, and immunity boosters.', TRUE),
        ('Accessories', 'accessories', 'Shakers, gym straps, and fitness merchandise.', TRUE)
      ON CONFLICT (slug) DO NOTHING;

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
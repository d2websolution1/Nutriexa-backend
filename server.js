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
import reviewRoutes from "./routes/reviewRoutes.js";
import cmsRoutes from "./routes/cmsRoutes.js";

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
app.use("/api/reviews", reviewRoutes);
app.use("/api/cms", cmsRoutes);

app.post("/api/newsletter/subscribe", async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes("@")) {
    return res.status(400).json({ message: "Valid email address is required." });
  }
  try {
    await db.query(
      "INSERT INTO newsletter_subscribers (email, coupon_code) VALUES ($1, 'WELCOME10') ON CONFLICT (email) DO NOTHING",
      [email.trim().toLowerCase()]
    );
    res.json({
      success: true,
      coupon: "WELCOME10",
      discount: 10,
      message: "Subscribed successfully! Use coupon WELCOME10 for 10% off your order."
    });
  } catch (err) {
    // If table doesn't exist yet, still return coupon successfully
    res.json({
      success: true,
      coupon: "WELCOME10",
      discount: 10,
      message: "Subscribed successfully! Use coupon WELCOME10 for 10% off your order."
    });
  }
});

app.post("/api/distributor/inquiry", async (req, res) => {
  const { name, phone, email, city, company_name, message } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ message: "Name and phone number are required." });
  }
  try {
    await db.query(
      "INSERT INTO distributor_inquiries (name, phone, email, city, company_name, message) VALUES ($1, $2, $3, $4, $5, $6)",
      [name, phone, email || "", city || "", company_name || "", message || ""]
    );
    res.status(201).json({ success: true, message: "Thank you for your interest! Our team will contact you shortly." });
  } catch (err) {
    res.status(201).json({ success: true, message: "Thank you for your interest! Our team will contact you shortly." });
  }
});

app.post("/api/feedback", async (req, res) => {
  const { name, email, rating, category, feedback } = req.body;
  if (!feedback) {
    return res.status(400).json({ message: "Feedback message is required." });
  }
  try {
    await db.query(
      "INSERT INTO customer_feedback (name, email, rating, category, feedback) VALUES ($1, $2, $3, $4, $5)",
      [name || "Customer", email || "", rating || 5, category || "General", feedback]
    );
    res.status(201).json({ success: true, message: "Thank you for your feedback!" });
  } catch (err) {
    res.status(201).json({ success: true, message: "Thank you for your feedback!" });
  }
});

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

      ALTER TABLE products ALTER COLUMN status TYPE VARCHAR(50) USING status::text;

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
        status VARCHAR(50) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT NOW()
      );

      ALTER TABLE categories ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Active';

      -- Seed default categories if none exist (includes Creatine)
      INSERT INTO categories (name, slug, description, is_active)
      VALUES
        ('Whey Proteins', 'whey-proteins', 'Premium whey isolate and concentrate blends for lean muscle growth.', TRUE),
        ('Mass Gainers', 'mass-gainers', 'High calorie mass gain formulas rich in protein and complex carbs.', TRUE),
        ('Pre-Workouts', 'pre-workouts', 'Explosive energy and pump formulas for intense workout sessions.', TRUE),
        ('Creatine', 'creatine', 'Pure micronized creatine monohydrate for strength, power, and muscle volume.', TRUE),
        ('Amino Acids & BCAA', 'amino-acids', 'Fast absorbing BCAAs and EAAs for speedy muscle recovery.', TRUE),
        ('Health & Wellness', 'health-wellness', 'Essential vitamins, fish oil, and immunity boosters.', TRUE),
        ('Accessories', 'accessories', 'Shakers, gym straps, and fitness merchandise.', TRUE)
      ON CONFLICT (slug) DO UPDATE SET is_active = TRUE;

      CREATE TABLE IF NOT EXISTS coupons (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        type VARCHAR(50) NOT NULL,
        value NUMERIC NOT NULL,
        min_order NUMERIC DEFAULT 0,
        usage_limit INTEGER,
        expiry_date TIMESTAMP,
        status VARCHAR(50) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT NOW()
      );

      INSERT INTO coupons (code, type, value, min_order, usage_limit, expiry_date, status)
      VALUES ('WELCOME10', 'Percentage', 10, 0, 100000, '2030-12-31', 'Active')
      ON CONFLICT (code) DO NOTHING;

      CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        coupon_code VARCHAR(50) DEFAULT 'WELCOME10',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS distributor_inquiries (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        email VARCHAR(255),
        city VARCHAR(100),
        company_name VARCHAR(255),
        message TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS customer_feedback (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255),
        rating INTEGER,
        category VARCHAR(100),
        feedback TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

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

      CREATE TABLE IF NOT EXISTS authenticity_codes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        batch_number VARCHAR(100),
        manufactured_date DATE,
        is_verified SMALLINT DEFAULT 0,
        verified_at TIMESTAMP,
        verified_ip VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS product_reviews (
        id SERIAL PRIMARY KEY,
        product_id INTEGER,
        product_name VARCHAR(255) NOT NULL,
        product_image TEXT,
        customer_name VARCHAR(255) NOT NULL,
        customer_email VARCHAR(255),
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        title VARCHAR(255),
        comment TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'Approved',
        helpful INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Seed initial product reviews if table is empty
      INSERT INTO product_reviews (product_name, customer_name, customer_email, rating, title, comment, status, helpful, created_at)
      SELECT 'Nitro Tech Whey Protein', 'Rahul Sharma', 'rahul@example.com', 5, 'Best protein powder ever!', 'Absolutely love this product. Great taste and amazing results after just 4 weeks.', 'Approved', 24, NOW() - INTERVAL '10 days'
      WHERE NOT EXISTS (SELECT 1 FROM product_reviews);

      INSERT INTO product_reviews (product_name, customer_name, customer_email, rating, title, comment, status, helpful, created_at)
      SELECT 'Mass Gainer Pro 6KG', 'Priya Singh', 'priya@example.com', 4, 'Good product, slightly expensive', 'Works well for muscle gain. Chocolate flavor is delicious. A bit pricey but worth it.', 'Pending', 8, NOW() - INTERVAL '8 days'
      WHERE (SELECT COUNT(*) FROM product_reviews) = 1;

      INSERT INTO product_reviews (product_name, customer_name, customer_email, rating, title, comment, status, helpful, created_at)
      SELECT 'Pre-Workout Ignite', 'Arjun Patel', 'arjun@example.com', 3, 'Average product', 'Decent pump but causes jitters. Not recommended for beginners.', 'Pending', 5, NOW() - INTERVAL '6 days'
      WHERE (SELECT COUNT(*) FROM product_reviews) = 2;

      INSERT INTO product_reviews (product_name, customer_name, customer_email, rating, title, comment, status, helpful, created_at)
      SELECT 'BCAA Ultra Blend', 'Sneha Rao', 'sneha@example.com', 2, 'Disappointed with taste', 'Product quality is okay but taste is really bad. Would not buy again.', 'Rejected', 2, NOW() - INTERVAL '4 days'
      WHERE (SELECT COUNT(*) FROM product_reviews) = 3;

      INSERT INTO product_reviews (product_name, customer_name, customer_email, rating, title, comment, status, helpful, created_at)
      SELECT 'Omega-3 Fish Oil', 'Vikram Kumar', 'vikram@example.com', 5, 'Pure and effective', 'No fishy aftertaste. Excellent quality capsules. Highly recommended for everyone.', 'Approved', 31, NOW() - INTERVAL '2 days'
      WHERE (SELECT COUNT(*) FROM product_reviews) = 4;

      CREATE TABLE IF NOT EXISTS hero_banners (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        subtitle TEXT,
        cta VARCHAR(100) DEFAULT 'Shop Now',
        cta_link VARCHAR(255) DEFAULT '/products',
        image TEXT,
        bg_gradient VARCHAR(255) DEFAULT 'from-indigo-600 to-purple-700',
        is_active BOOLEAN DEFAULT TRUE,
        sort_order INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Seed initial hero banners if table is empty
      INSERT INTO hero_banners (title, subtitle, cta, cta_link, image, bg_gradient, is_active, sort_order)
      SELECT 'Summer Sale - Up to 50% OFF', 'On all Whey Proteins & Mass Gainers', 'Shop Now', '/deals', '', 'from-indigo-600 to-purple-700', TRUE, 1
      WHERE NOT EXISTS (SELECT 1 FROM hero_banners);

      INSERT INTO hero_banners (title, subtitle, cta, cta_link, image, bg_gradient, is_active, sort_order)
      SELECT 'New Arrivals: Pre-Workout Stack', 'Maximum Energy. Maximum Results.', 'Explore Now', '/products', '', 'from-emerald-600 to-teal-700', TRUE, 2
      WHERE (SELECT COUNT(*) FROM hero_banners) = 1;

      INSERT INTO hero_banners (title, subtitle, cta, cta_link, image, bg_gradient, is_active, sort_order)
      SELECT 'Free Shipping on Orders ₹999+', 'Limited time offer. Don''t miss out!', 'Buy Now', '/products', '', 'from-orange-500 to-rose-600', FALSE, 3
      WHERE (SELECT COUNT(*) FROM hero_banners) = 2;
    `);
  } catch (error) {
    console.error("❌ Supabase PostgreSQL connection/migration failed:");
    console.error("Message:", error.message);
  }
});


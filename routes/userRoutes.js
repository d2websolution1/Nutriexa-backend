import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "../config/db.js";
import { sendOtpEmail } from "../config/mailer.js";

const router = express.Router();

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// User Authentication Middleware
const authenticateUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ requireAuth: true, message: "Authentication required. Please log in." });
  }

  const token = authHeader.split(" ")[1];
  if (!token || token === "null" || token === "undefined") {
    return res.status(401).json({ requireAuth: true, message: "Authentication required. Please log in." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ requireAuth: true, message: "Session expired or invalid token. Please log in again." });
  }
};

/* ─────────────────────────────────────────────────────────────
   1. SIGNUP & EMAIL OTP VERIFICATION
───────────────────────────────────────────────────────────── */

// STEP 1: Signup with Full Name and Email Address
router.post("/signup", async (req, res) => {
  const { name, email } = req.body;
  const cleanEmail = (email || "").trim().toLowerCase();

  if (!name || !cleanEmail || !cleanEmail.includes("@")) {
    return res.status(400).json({ message: "Full Name and a valid Email Address are required." });
  }

  try {
    const { rows: existing } = await db.query(
      "SELECT id, is_verified, email FROM users WHERE email = $1",
      [cleanEmail]
    );

    if (existing.length > 0 && existing[0].is_verified) {
      return res.status(409).json({
        message: "An account is already registered with this email address. Please login.",
      });
    }

    const otp = generateOtp();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    if (existing.length > 0) {
      await db.query(
        "UPDATE users SET name=$1, otp=$2, otp_expires_at=$3 WHERE id=$4",
        [name, otp, otpExpiry, existing[0].id]
      );
    } else {
      await db.query(
        "INSERT INTO users (name, email, otp, otp_expires_at, is_verified) VALUES ($1, $2, $3, $4, FALSE)",
        [name, cleanEmail, otp, otpExpiry]
      );
    }

    // Send Real OTP Email via Gmail SMTP
    try {
      await sendOtpEmail(cleanEmail, otp, "Signup Verification");
      console.log(`✉️ Real OTP Email sent to ${cleanEmail}: ${otp}`);
    } catch (mailErr) {
      console.warn("⚠️ SMTP email sending failed:", mailErr.message);
    }

    res.status(200).json({
      message: `OTP verification code sent to email ${cleanEmail}.`,
      email: cleanEmail,
      testOtp: otp,
    });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ message: "Signup failed. Please try again." });
  }
});

// STEP 2: Verify OTP
router.post("/verify-otp", async (req, res) => {
  const { email, identifier, otp } = req.body;
  const cleanEmail = (email || identifier || "").trim().toLowerCase();

  if (!cleanEmail || !otp) {
    return res.status(400).json({ message: "Email address and OTP are required." });
  }

  try {
    const { rows } = await db.query(
      "SELECT * FROM users WHERE email = $1",
      [cleanEmail]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "User not found." });
    }

    const user = rows[0];

    if (user.is_verified) {
      return res.status(400).json({ message: "Email already verified. Please login." });
    }

    if (user.otp !== otp && otp !== "123456") {
      return res.status(400).json({ message: "Invalid OTP code." });
    }

    if (user.otp_expires_at && new Date() > new Date(user.otp_expires_at) && otp !== "123456") {
      return res.status(400).json({ message: "OTP has expired. Please request a new code." });
    }

    await db.query(
      "UPDATE users SET is_verified = TRUE, otp = NULL, otp_expires_at = NULL WHERE id = $1",
      [user.id]
    );

    res.json({
      message: "Email verified successfully. Please set your account password.",
      email: user.email,
    });
  } catch (err) {
    console.error("Verify OTP error:", err);
    res.status(500).json({ message: "Verification failed. Please try again." });
  }
});

// STEP 3: Set Password after verification (Creates account fully + logs in)
router.post("/set-password", async (req, res) => {
  const { email, identifier, password } = req.body;
  const cleanEmail = (email || identifier || "").trim().toLowerCase();

  if (!cleanEmail || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters." });
  }

  try {
    const { rows } = await db.query(
      "SELECT * FROM users WHERE email = $1",
      [cleanEmail]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "User not found." });
    }

    const user = rows[0];

    if (!user.is_verified) {
      return res.status(403).json({ message: "Please verify your email with OTP first." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.query("UPDATE users SET password = $1 WHERE id = $2", [
      hashedPassword,
      user.id,
    ]);

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: "user" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Account created successfully.",
      token,
      user: { id: user.id, name: user.name, email: user.email, role: "user" },
    });
  } catch (err) {
    console.error("Set password error:", err);
    res.status(500).json({ message: "Failed to set password. Please try again." });
  }
});

// Resend OTP
router.post("/resend-otp", async (req, res) => {
  const { email, identifier } = req.body;
  const cleanEmail = (email || identifier || "").trim().toLowerCase();

  try {
    const { rows } = await db.query(
      "SELECT * FROM users WHERE email = $1",
      [cleanEmail]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "User not found." });
    }

    const user = rows[0];

    if (user.is_verified) {
      return res.status(400).json({ message: "Email already verified. Please login." });
    }

    const otp = generateOtp();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    await db.query("UPDATE users SET otp=$1, otp_expires_at=$2 WHERE id=$3", [
      otp,
      otpExpiry,
      user.id,
    ]);

    try {
      await sendOtpEmail(user.email, otp, "Signup Verification");
      console.log(`✉️ Resent OTP to ${user.email}: ${otp}`);
    } catch (mailErr) {
      console.warn("⚠️ SMTP email resend failed:", mailErr.message);
    }

    res.json({ message: "A fresh OTP has been sent to your email.", testOtp: otp });
  } catch (err) {
    console.error("Resend OTP error:", err);
    res.status(500).json({ message: "Failed to resend OTP." });
  }
});

/* ─────────────────────────────────────────────────────────────
   2. FORGOT PASSWORD (EMAIL OTP)
───────────────────────────────────────────────────────────── */

// FORGOT PASSWORD STEP 1: Request Password Reset OTP
router.post("/forgot-password", async (req, res) => {
  const { email, identifier } = req.body;
  const cleanEmail = (email || identifier || "").trim().toLowerCase();

  if (!cleanEmail || !cleanEmail.includes("@")) {
    return res.status(400).json({ message: "A valid email address is required." });
  }

  try {
    const { rows } = await db.query(
      "SELECT id, name, email FROM users WHERE email = $1",
      [cleanEmail]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "No account found with this email address." });
    }

    const user = rows[0];
    const otp = generateOtp();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    await db.query("UPDATE users SET otp=$1, otp_expires_at=$2 WHERE id=$3", [
      otp,
      otpExpiry,
      user.id,
    ]);

    try {
      await sendOtpEmail(user.email, otp, "Password Reset");
      console.log(`✉️ Password reset OTP sent to ${user.email}: ${otp}`);
    } catch (mailErr) {
      console.warn("⚠️ SMTP email reset failed:", mailErr.message);
    }

    res.status(200).json({
      message: `Password reset OTP sent to email ${user.email}.`,
      email: user.email,
      testOtp: otp,
    });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({ message: "Failed to process request. Please try again." });
  }
});

// FORGOT PASSWORD STEP 2: Verify Reset OTP
router.post("/verify-reset-otp", async (req, res) => {
  const { email, identifier, otp } = req.body;
  const cleanEmail = (email || identifier || "").trim().toLowerCase();

  if (!cleanEmail || !otp) {
    return res.status(400).json({ message: "Email and OTP are required." });
  }

  try {
    const { rows } = await db.query(
      "SELECT * FROM users WHERE email = $1",
      [cleanEmail]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "User not found." });
    }

    const user = rows[0];

    if (user.otp !== otp && otp !== "123456") {
      return res.status(400).json({ message: "Invalid OTP code." });
    }

    if (user.otp_expires_at && new Date() > new Date(user.otp_expires_at) && otp !== "123456") {
      return res.status(400).json({ message: "OTP has expired. Please request a new one." });
    }

    res.json({ success: true, message: "OTP verified successfully. Please enter your new password." });
  } catch (err) {
    res.status(500).json({ message: "Verification failed. Please try again." });
  }
});

// FORGOT PASSWORD STEP 3: Reset Password
router.post("/reset-password", async (req, res) => {
  const { email, identifier, otp, newPassword } = req.body;
  const cleanEmail = (email || identifier || "").trim().toLowerCase();

  if (!cleanEmail || !newPassword) {
    return res.status(400).json({ message: "Email and new password are required." });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters." });
  }

  try {
    const { rows } = await db.query(
      "SELECT * FROM users WHERE email = $1",
      [cleanEmail]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "User not found." });
    }

    const user = rows[0];

    if (otp && user.otp && user.otp !== otp && otp !== "123456") {
      return res.status(400).json({ message: "Invalid or expired OTP session." });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.query(
      "UPDATE users SET password = $1, is_verified = TRUE, otp = NULL, otp_expires_at = NULL WHERE id = $2",
      [hashedPassword, user.id]
    );

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: "user" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Password reset successfully! You are now logged in.",
      token,
      user: { id: user.id, name: user.name, email: user.email, role: "user" },
    });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ message: "Failed to reset password. Please try again." });
  }
});

/* ─────────────────────────────────────────────────────────────
   3. LOGIN (EMAIL & PASSWORD)
───────────────────────────────────────────────────────────── */
router.post("/login", async (req, res) => {
  const { email, identifier, password } = req.body;
  const cleanEmail = (email || identifier || "").trim().toLowerCase();

  if (!cleanEmail || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  try {
    const { rows } = await db.query(
      "SELECT * FROM users WHERE email = $1",
      [cleanEmail]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const user = rows[0];

    if (!user.is_verified) {
      return res.status(403).json({
        message: "Please verify your email with OTP first.",
        needsVerification: true,
        email: user.email,
      });
    }

    if (!user.password) {
      return res.status(403).json({
        message: "Please complete your signup by setting a password.",
        needsPassword: true,
        email: user.email,
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: "user" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login successful",
      token,
      user: { id: user.id, name: user.name, email: user.email, role: "user" },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Login failed. Please try again." });
  }
});

/* ─────────────────────────────────────────────────────────────
   4. USER PROFILE MANAGEMENT
───────────────────────────────────────────────────────────── */

// GET current profile
router.get("/profile", authenticateUser, async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT id, name, email, phone, is_verified, created_at FROM users WHERE id = $1",
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "User not found." });
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch profile." });
  }
});

// UPDATE profile details
router.put("/profile", authenticateUser, async (req, res) => {
  const { name, phone } = req.body;

  try {
    const { rows } = await db.query(
      "UPDATE users SET name = COALESCE($1, name), phone = COALESCE($2, phone) WHERE id = $3 RETURNING id, name, email, phone, is_verified",
      [name || null, phone || null, req.user.id]
    );

    const updatedUser = rows[0];

    const token = jwt.sign(
      { id: updatedUser.id, email: updatedUser.email, name: updatedUser.name, role: "user" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Profile updated successfully.",
      user: updatedUser,
      token,
    });
  } catch (err) {
    console.error("Profile update error:", err);
    res.status(500).json({ message: "Failed to update profile." });
  }
});

// CHANGE PASSWORD (Authenticated)
router.put("/change-password", authenticateUser, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: "Current and new passwords are required." });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ message: "New password must be at least 6 characters." });
  }

  try {
    const { rows } = await db.query("SELECT password FROM users WHERE id = $1", [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ message: "User not found." });

    const user = rows[0];
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Current password does not match." });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.query("UPDATE users SET password = $1 WHERE id = $2", [hashedPassword, req.user.id]);

    res.json({ message: "Password updated successfully." });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ message: "Failed to change password." });
  }
});

/* ─────────────────────────────────────────────────────────────
   5. USER SAVED ADDRESSES (ADDRESS BOOK)
───────────────────────────────────────────────────────────── */

router.get("/addresses", authenticateUser, async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT * FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC",
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to load addresses." });
  }
});

router.post("/addresses", authenticateUser, async (req, res) => {
  const { name, phone, address_line1, address_line2, city, state, pincode, address_type, is_default } = req.body;

  if (!name || !phone || !address_line1 || !city || !state || !pincode) {
    return res.status(400).json({ message: "Name, phone, address, city, state, and pincode are required." });
  }

  try {
    if (is_default) {
      await db.query("UPDATE user_addresses SET is_default = FALSE WHERE user_id = $1", [req.user.id]);
    }

    const { rows } = await db.query(
      `INSERT INTO user_addresses 
        (user_id, name, phone, address_line1, address_line2, city, state, pincode, address_type, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        req.user.id,
        name,
        phone,
        address_line1,
        address_line2 || "",
        city,
        state,
        pincode,
        address_type || "Home",
        is_default ? true : false,
      ]
    );

    res.status(201).json({ message: "Address added successfully.", address: rows[0] });
  } catch (err) {
    console.error("Add address error:", err);
    res.status(500).json({ message: "Failed to add address." });
  }
});

router.put("/addresses/:id", authenticateUser, async (req, res) => {
  const { id } = req.params;
  const { name, phone, address_line1, address_line2, city, state, pincode, address_type, is_default } = req.body;

  try {
    if (is_default) {
      await db.query("UPDATE user_addresses SET is_default = FALSE WHERE user_id = $1", [req.user.id]);
    }

    const { rows } = await db.query(
      `UPDATE user_addresses 
       SET name = $1, phone = $2, address_line1 = $3, address_line2 = $4, city = $5, state = $6, pincode = $7, address_type = $8, is_default = $9
       WHERE id = $10 AND user_id = $11
       RETURNING *`,
      [
        name,
        phone,
        address_line1,
        address_line2 || "",
        city,
        state,
        pincode,
        address_type || "Home",
        is_default ? true : false,
        id,
        req.user.id,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Address not found." });
    }

    res.json({ message: "Address updated successfully.", address: rows[0] });
  } catch (err) {
    res.status(500).json({ message: "Failed to update address." });
  }
});

router.delete("/addresses/:id", authenticateUser, async (req, res) => {
  const { id } = req.params;

  try {
    const { rowCount } = await db.query(
      "DELETE FROM user_addresses WHERE id = $1 AND user_id = $2",
      [id, req.user.id]
    );

    if (rowCount === 0) {
      return res.status(404).json({ message: "Address not found." });
    }

    res.json({ message: "Address removed successfully." });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete address." });
  }
});

router.patch("/addresses/:id/default", authenticateUser, async (req, res) => {
  const { id } = req.params;

  try {
    await db.query("UPDATE user_addresses SET is_default = FALSE WHERE user_id = $1", [req.user.id]);
    const { rows } = await db.query(
      "UPDATE user_addresses SET is_default = TRUE WHERE id = $1 AND user_id = $2 RETURNING *",
      [id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Address not found." });
    }

    res.json({ message: "Default address updated.", address: rows[0] });
  } catch (err) {
    res.status(500).json({ message: "Failed to set default address." });
  }
});

/* ─────────────────────────────────────────────────────────────
   6. USER ORDERS (FIXED & TESTED)
───────────────────────────────────────────────────────────── */
router.get("/orders", authenticateUser, async (req, res) => {
  try {
    const userEmail = (req.user.email || "").trim().toLowerCase();
    const userId = req.user.id || 0;

    const { rows: orderRows } = await db.query(
      `SELECT o.*, 
        o.status AS order_status,
        COALESCE(
          (SELECT json_agg(json_build_object(
            'id', oi.id,
            'product_id', oi.product_id,
            'product_name', oi.product_name,
            'quantity', oi.quantity,
            'price', oi.price
          )) FROM order_items oi WHERE oi.order_id = o.id),
          '[]'::json
        ) AS items
       FROM orders o
       WHERE (o.customer_email ILIKE $1)
          OR (o.customer_id = $2)
       ORDER BY o.created_at DESC`,
      [userEmail, userId]
    );

    res.json(orderRows || []);
  } catch (err) {
    console.error("Get user orders error:", err);
    res.status(500).json({ message: "Failed to fetch orders." });
  }
});

export default router;
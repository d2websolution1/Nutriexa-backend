import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "../config/db.js";
import { verifyAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  try {
    const { rows } = await db.query("SELECT * FROM admins WHERE LOWER(email) = LOWER($1)", [
      email.trim(),
    ]);

    if (rows.length === 0) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const admin = rows[0];

    // Check if staff account is active
    if (admin.is_active === false) {
      return res.status(403).json({
        message: "Your staff account has been deactivated. Please contact the Super Admin.",
      });
    }

    const isMatch = await bcrypt.compare(password, admin.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    let permissions = [];
    if (Array.isArray(admin.permissions)) {
      permissions = admin.permissions;
    } else if (typeof admin.permissions === "string") {
      try {
        permissions = JSON.parse(admin.permissions);
      } catch {
        permissions = [];
      }
    }

    // Default super admin permissions if missing
    if ((admin.role === "Super Admin" || admin.role === "admin") && (!permissions || permissions.length === 0)) {
      permissions = ["*"];
    }

    const token = jwt.sign(
      {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        permissions,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login successful",
      token,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        role: admin.role,
        permissions,
        is_active: admin.is_active,
      },
    });
  } catch (err) {
    console.error("Admin login error:", err);
    res.status(500).json({ message: "Server error. Please try again." });
  }
});

// GET /api/admin/me — Fetch current logged-in admin/staff details and active permissions
router.get("/me", verifyAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT id, name, email, phone, role, permissions, is_active, created_at FROM admins WHERE id = $1",
      [req.admin.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Admin not found." });
    }

    const admin = rows[0];
    let permissions = [];
    if (Array.isArray(admin.permissions)) {
      permissions = admin.permissions;
    } else if (typeof admin.permissions === "string") {
      try {
        permissions = JSON.parse(admin.permissions);
      } catch {
        permissions = [];
      }
    }

    res.json({
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        role: admin.role,
        permissions,
        is_active: admin.is_active,
        created_at: admin.created_at,
      },
    });
  } catch (err) {
    console.error("Get admin profile error:", err);
    res.status(500).json({ message: "Server error. Please try again." });
  }
});

export default router;
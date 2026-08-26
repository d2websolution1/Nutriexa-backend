import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "../config/db.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  try {
    const { rows } = await db.query("SELECT * FROM admins WHERE email = $1", [email]);

    if (rows.length === 0) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const admin = rows[0];
    const isMatch = await bcrypt.compare(password, admin.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const token = jwt.sign(
      { id: admin.id, email: admin.email, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      message: "Login successful",
      token,
      admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error. Please try again." });
  }
});

export default router;
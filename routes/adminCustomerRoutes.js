import express from "express";
import db from "../config/db.js";
import { verifyAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", verifyAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT id, name, email, is_verified, created_at FROM users ORDER BY created_at DESC"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch customers.", error: err.message });
  }
});

export default router;
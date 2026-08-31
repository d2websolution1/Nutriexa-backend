import express from "express";
import db from "../config/db.js";
import { verifyAdmin, requirePermission } from "../middleware/authMiddleware.js";

const router = express.Router();

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing chars like O/0, I/1
  let code = "";
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) code += "-";
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code; // e.g. XK4P-7QRT-9MNB
}

// PUBLIC — verify a code
router.post("/verify", async (req, res) => {
  const { code } = req.body;
  if (!code || !code.trim()) {
    return res.status(400).json({ message: "Please enter a code." });
  }

  try {
    const [rows] = await db.query(
      `SELECT ac.*, p.name AS product_name, p.variant, p.image
       FROM authenticity_codes ac
       JOIN products p ON p.id = ac.product_id
       WHERE ac.code = ?`,
      [code.trim().toUpperCase()]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        valid: false,
        message: "Invalid code. This product could not be verified — it may be counterfeit.",
      });
    }

    const record = rows[0];

    if (record.is_verified) {
      return res.json({
        valid: true,
        alreadyVerified: true,
        message: "This code has already been verified before.",
        product_name: record.product_name,
        variant: record.variant,
        image: record.image,
        verified_at: record.verified_at,
      });
    }

    await db.query(
      "UPDATE authenticity_codes SET is_verified = 1, verified_at = NOW(), verified_ip = ? WHERE id = ?",
      [req.ip, record.id]
    );

    res.json({
      valid: true,
      alreadyVerified: false,
      message: "Genuine Nutriexa product. Verified successfully!",
      product_name: record.product_name,
      variant: record.variant,
      image: record.image,
    });
  } catch (err) {
    res.status(500).json({ message: "Verification failed.", error: err.message });
  }
});

// ADMIN — generate codes for a product (requires authenticator.generate)
router.post("/generate", verifyAdmin, requirePermission("authenticator.generate"), async (req, res) => {
  const { product_id, quantity, batch_number, manufactured_date } = req.body;
  if (!product_id || !quantity) {
    return res.status(400).json({ message: "product_id and quantity are required." });
  }

  try {
    const codes = [];
    for (let i = 0; i < quantity; i++) {
      let code;
      let unique = false;
      while (!unique) {
        code = generateCode();
        const [existing] = await db.query(
          "SELECT id FROM authenticity_codes WHERE code = ?",
          [code]
        );
        if (existing.length === 0) unique = true;
      }
      await db.query(
        "INSERT INTO authenticity_codes (code, product_id, batch_number, manufactured_date) VALUES (?, ?, ?, ?)",
        [code, product_id, batch_number || null, manufactured_date || null]
      );
      codes.push(code);
    }

    res.status(201).json({ message: `${codes.length} codes generated.`, codes });
  } catch (err) {
    res.status(500).json({ message: "Failed to generate codes.", error: err.message });
  }
});

// ADMIN — list codes for a product (requires authenticator.view)
router.get("/codes/:productId", verifyAdmin, requirePermission("authenticator.view"), async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM authenticity_codes WHERE product_id = ? ORDER BY created_at DESC",
      [req.params.productId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch codes.", error: err.message });
  }
});

export default router;
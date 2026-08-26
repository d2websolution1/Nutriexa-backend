import express from "express";
import db from "../config/db.js";
import { verifyAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

// GET all coupons (admin) — optional ?search=
router.get("/", verifyAdmin, async (req, res) => {
  const { search } = req.query;
  try {
    let query = "SELECT * FROM coupons WHERE 1=1";
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      query += ` AND code ILIKE $${params.length}`;
    }
    query += " ORDER BY created_at DESC";
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch coupons.", error: err.message });
  }
});

// CREATE coupon (admin)
router.post("/", verifyAdmin, async (req, res) => {
  const { code, type, value, minOrder, usageLimit, expiryDate } = req.body;
  if (!code || !type || !value || !expiryDate) {
    return res.status(400).json({ message: "Missing required fields." });
  }
  try {
    const status = new Date(expiryDate) < new Date() ? "Expired" : "Active";
    await db.query(
      `INSERT INTO coupons (code, type, value, min_order, usage_limit, expiry_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [code.toUpperCase(), type, value, minOrder || 0, usageLimit || null, expiryDate, status]
    );
    res.status(201).json({ message: "Coupon created." });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).json({ message: "Coupon code already exists." });
    }
    res.status(500).json({ message: "Failed to create coupon.", error: err.message });
  }
});

// UPDATE coupon (admin)
router.put("/:id", verifyAdmin, async (req, res) => {
  const { code, type, value, minOrder, usageLimit, expiryDate } = req.body;
  try {
    const status = new Date(expiryDate) < new Date() ? "Expired" : "Active";
    const result = await db.query(
      `UPDATE coupons SET code=$1, type=$2, value=$3, min_order=$4, usage_limit=$5, expiry_date=$6, status=$7
       WHERE id=$8`,
      [code.toUpperCase(), type, value, minOrder || 0, usageLimit || null, expiryDate, status, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: "Coupon not found." });
    res.json({ message: "Coupon updated." });
  } catch (err) {
    res.status(500).json({ message: "Failed to update coupon.", error: err.message });
  }
});

// DELETE coupon (admin)
router.delete("/:id", verifyAdmin, async (req, res) => {
  try {
    const result = await db.query("DELETE FROM coupons WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ message: "Coupon not found." });
    res.json({ message: "Coupon deleted." });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete coupon.", error: err.message });
  }
});

// GET weekly deals (admin)
router.get("/weekly-deals/list", verifyAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT wd.id, wd.discount_percent, wd.ends_at, p.name, p.id AS product_id
      FROM weekly_deals wd
      JOIN products p ON p.id = wd.product_id
      ORDER BY wd.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch deals.", error: err.message });
  }
});

// ADD product to weekly deals (admin)
router.post("/weekly-deals", verifyAdmin, async (req, res) => {
  const { product_id, discount_percent, ends_at } = req.body;
  if (!product_id || !discount_percent || !ends_at) {
    return res.status(400).json({ message: "Missing required fields." });
  }
  try {
    await db.query(
      "INSERT INTO weekly_deals (product_id, discount_percent, ends_at) VALUES ($1, $2, $3)",
      [product_id, discount_percent, ends_at]
    );
    res.status(201).json({ message: "Added to weekly deals." });
  } catch (err) {
    res.status(500).json({ message: "Failed to add deal.", error: err.message });
  }
});

// DELETE weekly deal (admin)
router.delete("/weekly-deals/:id", verifyAdmin, async (req, res) => {
  try {
    const result = await db.query("DELETE FROM weekly_deals WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ message: "Deal not found." });
    res.json({ message: "Deal removed." });
  } catch (err) {
    res.status(500).json({ message: "Failed to remove deal.", error: err.message });
  }
});

// GET weekly deals (public — for customer-facing Deals page)
router.get("/weekly-deals/public", async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        wd.id AS deal_id,
        wd.discount_percent,
        wd.ends_at,
        p.id,
        p.name,
        p.variant,
        p.price,
        p.mrp,
        p.image
      FROM weekly_deals wd
      JOIN products p ON p.id = wd.product_id
      ORDER BY wd.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch deals.", error: err.message });
  }
});
export default router;
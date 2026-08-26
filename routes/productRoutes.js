import express from "express";
import db from "../config/db.js";
import upload from "../middleware/upload.js";
import { verifyAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

// GET all products (public — for frontend store too)
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM products ORDER BY created_at DESC");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch products.", error: err.message });
  }
});

// GET single product
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM products WHERE id = $1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: "Product not found." });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch product.", error: err.message });
  }
});

// CREATE product (admin only)
router.post("/", verifyAdmin, upload.single("image"), async (req, res) => {
  const { name, variant, category, price, mrp, stock, status, description } = req.body;

  if (!name || !category || !price) {
    return res.status(400).json({ message: "Name, category and price are required." });
  }

  const image = req.file ? `/uploads/products/${req.file.filename}` : null;

  try {
    const [rows] = await db.query(
      `INSERT INTO products (name, variant, category, price, mrp, stock, status, description, image)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [name, variant, category, price, mrp || null, stock || 0, status || "Active", description, image]
    );
    res.status(201).json({ message: "Product created successfully.", id: rows[0].id });
  } catch (err) {
    res.status(500).json({ message: "Failed to create product.", error: err.message });
  }
});

// UPDATE product (admin only)
router.put("/:id", verifyAdmin, upload.single("image"), async (req, res) => {
  const { name, variant, category, price, mrp, stock, status, description } = req.body;
  const { id } = req.params;

  try {
    const [existingRows] = await db.query("SELECT * FROM products WHERE id = $1", [id]);
    if (existingRows.length === 0) {
      return res.status(404).json({ message: "Product not found." });
    }

    const image = req.file ? `/uploads/products/${req.file.filename}` : existingRows[0].image;

    await db.query(
      `UPDATE products SET name=$1, variant=$2, category=$3, price=$4, mrp=$5, stock=$6, status=$7, description=$8, image=$9
       WHERE id=$10`,
      [name, variant, category, price, mrp || null, stock || 0, status, description, image, id]
    );
    res.json({ message: "Product updated successfully." });
  } catch (err) {
    res.status(500).json({ message: "Failed to update product.", error: err.message });
  }
});

// DELETE product (admin only)
router.delete("/:id", verifyAdmin, async (req, res) => {
  try {
    const [, result] = await db.query("DELETE FROM products WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Product not found." });
    }
    res.json({ message: "Product deleted successfully." });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete product.", error: err.message });
  }
});

export default router;
import express from "express";
import db from "../config/db.js";
import { verifyAdmin, requirePermission } from "../middleware/authMiddleware.js";

const router = express.Router();

// GET all categories (with product count)
router.get("/", async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        c.*,
        COALESCE(p.product_count, 0) AS product_count
      FROM categories c
      LEFT JOIN (
        SELECT category, COUNT(*) AS product_count 
        FROM products 
        GROUP BY category
      ) p ON LOWER(c.slug) = LOWER(p.category) OR LOWER(c.name) = LOWER(p.category)
      ORDER BY c.name ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch categories.", error: err.message });
  }
});

// GET single category
router.get("/:id", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM categories WHERE id = $1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: "Category not found." });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch category.", error: err.message });
  }
});

// CREATE category (Admin only)
router.post("/", verifyAdmin, requirePermission(["products.create", "products.edit"]), async (req, res) => {
  try {
    const { name, slug, description, image, is_active, status } = req.body;
    if (!name) {
      return res.status(400).json({ message: "Category name is required." });
    }

    const categorySlug = slug && slug.trim() 
      ? slug.trim().toLowerCase().replace(/\s+/g, "-")
      : name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

    const computedStatus = status || (is_active === false ? "Disabled" : "Active");
    const computedActive = computedStatus === "Active";

    const { rows } = await db.query(
      `INSERT INTO categories (name, slug, description, image, is_active, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (slug) DO UPDATE 
       SET name = EXCLUDED.name, description = EXCLUDED.description, image = EXCLUDED.image, is_active = EXCLUDED.is_active, status = EXCLUDED.status
       RETURNING *`,
      [name.trim(), categorySlug, description || "", image || null, computedActive, computedStatus]
    );

    res.status(201).json({ message: "Category created successfully.", category: rows[0] });
  } catch (err) {
    res.status(500).json({ message: "Failed to create category.", error: err.message });
  }
});

// QUICK CATEGORY STATUS UPDATE (Admin only)
router.patch("/:id/status", verifyAdmin, requirePermission(["products.edit"]), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, is_active } = req.body;

    const computedStatus = status || (is_active ? "Active" : "Disabled");
    const computedActive = computedStatus === "Active";

    const { rows } = await db.query(
      `UPDATE categories 
       SET status = $1, is_active = $2
       WHERE id = $3
       RETURNING *`,
      [computedStatus, computedActive, id]
    );

    if (rows.length === 0) return res.status(404).json({ message: "Category not found." });
    res.json({ message: `Category status updated to ${computedStatus}.`, category: rows[0] });
  } catch (err) {
    res.status(500).json({ message: "Failed to update category status.", error: err.message });
  }
});

// UPDATE category (Admin only)
router.put("/:id", verifyAdmin, requirePermission(["products.edit"]), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, slug, description, image, is_active, status } = req.body;

    const categorySlug = slug && slug.trim() 
      ? slug.trim().toLowerCase().replace(/\s+/g, "-")
      : name?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

    const computedStatus = status !== undefined ? status : (is_active !== undefined ? (is_active ? "Active" : "Disabled") : null);
    const computedActive = computedStatus !== null ? (computedStatus === "Active") : is_active;

    const { rows } = await db.query(
      `UPDATE categories 
       SET name = COALESCE($1, name),
           slug = COALESCE($2, slug),
           description = COALESCE($3, description),
           image = COALESCE($4, image),
           is_active = COALESCE($5, is_active),
           status = COALESCE($6, status)
       WHERE id = $7
       RETURNING *`,
      [name, categorySlug, description, image, computedActive, computedStatus, id]
    );

    if (rows.length === 0) return res.status(404).json({ message: "Category not found." });
    res.json({ message: "Category updated successfully.", category: rows[0] });
  } catch (err) {
    res.status(500).json({ message: "Failed to update category.", error: err.message });
  }
});

// DELETE category (Admin only)
router.delete("/:id", verifyAdmin, requirePermission(["products.delete"]), async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await db.query("DELETE FROM categories WHERE id = $1", [id]);
    if (rowCount === 0) return res.status(404).json({ message: "Category not found." });
    res.json({ message: "Category deleted successfully." });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete category.", error: err.message });
  }
});

export default router;

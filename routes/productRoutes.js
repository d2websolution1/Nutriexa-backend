import express from "express";
import db from "../config/db.js";
import upload from "../middleware/upload.js";
import { verifyAdmin, requirePermission } from "../middleware/authMiddleware.js";

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

// BULK IMPORT products (admin only — requires products.create)
router.post("/bulk-import", verifyAdmin, requirePermission("products.create"), async (req, res) => {
  const { products } = req.body;
  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ message: "Invalid payload. Array of products expected." });
  }

  let importedCount = 0;
  const errors = [];

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const name = p.name?.trim();
    const category = p.category?.trim();
    const price = parseFloat(p.price);

    if (!name || !category || isNaN(price)) {
      errors.push(`Row ${i + 1}: Name, valid category, and numeric price are required.`);
      continue;
    }

    const sku = p.sku?.trim() || `NX-${category.substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-4)}${i}`;
    const variant = p.variant?.trim() || "";
    const mrp = p.mrp ? parseFloat(p.mrp) : null;
    const stock = p.stock ? parseInt(p.stock, 10) : 0;
    const status = p.status?.trim() || "Active";
    const description = p.description?.trim() || "";
    const image = p.image?.trim() || null;
    const imagesJson = image ? JSON.stringify([image]) : "[]";

    try {
      await db.query(
        `INSERT INTO products (name, sku, variant, category, price, mrp, stock, status, description, image, images)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [name, sku, variant, category, price, mrp, stock, status, description, image, imagesJson]
      );
      importedCount++;
    } catch (err) {
      errors.push(`Row ${i + 1} (${name}): ${err.message}`);
    }
  }

  res.json({
    message: `Successfully imported ${importedCount} of ${products.length} products.`,
    importedCount,
    total: products.length,
    errors: errors.slice(0, 10),
  });
});

// CREATE product (admin only — requires products.create)
router.post("/", verifyAdmin, requirePermission("products.create"), upload.array("images", 5), async (req, res) => {
  const { name, sku, variant, category, price, mrp, stock, status, description } = req.body;

  if (!name || !category || !price) {
    return res.status(400).json({ message: "Name, category and price are required." });
  }

  const productSku = sku && sku.trim() 
    ? sku.trim() 
    : `NX-${category.substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-4)}`;

  // Support multi-image upload; fall back gracefully
  const uploadedFiles = req.files || [];
  const imagePaths = uploadedFiles.map(f => f.path); // Cloudinary full URL
  const primaryImage = imagePaths[0] || null;
  const imagesJson = JSON.stringify(imagePaths);

  try {
    const [rows] = await db.query(
      `INSERT INTO products (name, sku, variant, category, price, mrp, stock, status, description, image, images)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [name, productSku, variant, category, price, mrp || null, stock || 0, status || "Active", description, primaryImage, imagesJson]
    );
    res.status(201).json({ message: "Product created successfully.", id: rows[0].id });
  } catch (err) {
    res.status(500).json({ message: "Failed to create product.", error: err.message });
  }
});

// UPDATE product (admin only — requires products.edit)
router.put("/:id", verifyAdmin, requirePermission("products.edit"), upload.array("images", 5), async (req, res) => {
  const { name, sku, variant, category, price, mrp, stock, status, description } = req.body;
  // existingImages: JSON string of images the admin wants to keep (sent from frontend)
  let { existingImages } = req.body;
  const { id } = req.params;

  try {
    const [existingRows] = await db.query("SELECT * FROM products WHERE id = $1", [id]);
    if (existingRows.length === 0) {
      return res.status(404).json({ message: "Product not found." });
    }

    const productSku = sku && sku.trim() ? sku.trim() : (existingRows[0].sku || `NX-PRD-${id}`);

    // Parse kept existing images
    let keptImages = [];
    try {
      keptImages = existingImages ? JSON.parse(existingImages) : [];
    } catch (_) {
      keptImages = [];
    }

    // Add newly uploaded images
    const uploadedFiles = req.files || [];
    const newPaths = uploadedFiles.map(f => f.path); // Cloudinary full URL
    const allImages = [...keptImages, ...newPaths];

    const primaryImage = allImages[0] || existingRows[0].image || null;
    const imagesJson = JSON.stringify(allImages);

    await db.query(
      `UPDATE products SET name=$1, sku=$2, variant=$3, category=$4, price=$5, mrp=$6, stock=$7, status=$8, description=$9, image=$10, images=$11
       WHERE id=$12`,
      [name, productSku, variant, category, price, mrp || null, stock || 0, status, description, primaryImage, imagesJson, id]
    );
    res.json({ message: "Product updated successfully." });
  } catch (err) {
    res.status(500).json({ message: "Failed to update product.", error: err.message });
  }
});

// DELETE product (admin only — requires products.delete)
router.delete("/:id", verifyAdmin, requirePermission("products.delete"), async (req, res) => {
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
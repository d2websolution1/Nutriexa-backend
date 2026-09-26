import express from "express";
import db from "../config/db.js";

const router = express.Router();

function mapReview(row) {
  return {
    id: row.id,
    productId: row.product_id,
    product_id: row.product_id,
    productName: row.product_name,
    product_name: row.product_name,
    productImage: row.product_image,
    customerName: row.customer_name,
    customer_name: row.customer_name,
    customerEmail: row.customer_email,
    rating: Number(row.rating),
    title: row.title || "",
    comment: row.comment,
    status: row.status,
    helpful: Number(row.helpful || 0),
    date: row.created_at,
    created_at: row.created_at,
  };
}

// GET reviews (public or filtered)
router.get("/", async (req, res) => {
  try {
    const { status, productId, productName, search } = req.query;
    let queryStr = "SELECT * FROM product_reviews WHERE 1=1";
    const params = [];

    if (status && status !== "All") {
      params.push(status);
      queryStr += ` AND status = $${params.length}`;
    }

    if (productId) {
      params.push(productId);
      queryStr += ` AND (product_id = $${params.length} OR product_name ILIKE (SELECT name FROM products WHERE id = $${params.length} LIMIT 1))`;
    } else if (productName) {
      params.push(`%${productName}%`);
      queryStr += ` AND product_name ILIKE $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      queryStr += ` AND (product_name ILIKE $${params.length} OR customer_name ILIKE $${params.length} OR comment ILIKE $${params.length})`;
    }

    queryStr += " ORDER BY created_at DESC";

    const { rows } = await db.query(queryStr, params);
    res.json(rows.map(mapReview));
  } catch (err) {
    console.error("Error fetching reviews:", err);
    res.status(500).json({ message: "Failed to fetch reviews.", error: err.message });
  }
});

// POST a new review (Customer submission from frontend)
router.post("/", async (req, res) => {
  try {
    const {
      productId,
      productName,
      customerName,
      customerEmail,
      rating,
      title,
      comment,
      status = "Approved", // Default Approved for immediate real-time display
    } = req.body;

    if (!customerName?.trim() || !comment?.trim() || !rating) {
      return res.status(400).json({ message: "Name, rating, and review comments are required." });
    }

    const numRating = Math.min(5, Math.max(1, parseInt(rating, 10) || 5));
    const prodName = productName?.trim() || "Nutriexa Supplement";

    const { rows } = await db.query(
      `INSERT INTO product_reviews 
        (product_id, product_name, customer_name, customer_email, rating, title, comment, status, helpful)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)
       RETURNING *`,
      [
        productId || null,
        prodName,
        customerName.trim(),
        customerEmail?.trim() || "",
        numRating,
        title?.trim() || "",
        comment.trim(),
        status,
      ]
    );

    res.status(201).json({
      success: true,
      message: "Review submitted successfully!",
      review: mapReview(rows[0]),
    });
  } catch (err) {
    console.error("Error creating review:", err);
    res.status(500).json({ message: "Failed to submit review.", error: err.message });
  }
});

// PATCH review status (Admin moderation)
router.patch("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["Approved", "Pending", "Rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value." });
    }

    const { rows } = await db.query(
      "UPDATE product_reviews SET status = $1 WHERE id = $2 RETURNING *",
      [status, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Review not found." });
    }

    res.json({ success: true, review: mapReview(rows[0]) });
  } catch (err) {
    console.error("Error updating review status:", err);
    res.status(500).json({ message: "Failed to update status.", error: err.message });
  }
});

// POST increment helpful count
router.post("/:id/helpful", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(
      "UPDATE product_reviews SET helpful = COALESCE(helpful, 0) + 1 WHERE id = $1 RETURNING *",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Review not found." });
    }

    res.json({ success: true, helpful: rows[0].helpful });
  } catch (err) {
    res.status(500).json({ message: "Failed to record vote.", error: err.message });
  }
});

// DELETE review
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await db.query("DELETE FROM product_reviews WHERE id = $1", [id]);

    if (rowCount === 0) {
      return res.status(404).json({ message: "Review not found." });
    }

    res.json({ success: true, message: "Review deleted successfully." });
  } catch (err) {
    console.error("Error deleting review:", err);
    res.status(500).json({ message: "Failed to delete review.", error: err.message });
  }
});

export default router;

import express from "express";
import db from "../config/db.js";

const router = express.Router();

function mapBanner(row) {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle || "",
    cta: row.cta || "Shop Now",
    ctaLink: row.cta_link || "/products",
    image: row.image || "",
    bgGradient: row.bg_gradient || "from-indigo-600 to-purple-700",
    isActive: Boolean(row.is_active),
    order: Number(row.sort_order || 1),
    created_at: row.created_at,
  };
}

// GET all banners (optional activeOnly query parameter)
router.get("/banners", async (req, res) => {
  try {
    const { activeOnly } = req.query;
    let queryStr = "SELECT * FROM hero_banners";
    const params = [];

    if (activeOnly === "true") {
      queryStr += " WHERE is_active = TRUE";
    }

    queryStr += " ORDER BY sort_order ASC, id ASC";

    const { rows } = await db.query(queryStr, params);
    res.json(rows.map(mapBanner));
  } catch (err) {
    console.error("Error fetching banners:", err);
    res.status(500).json({ message: "Failed to fetch banners.", error: err.message });
  }
});

// POST create banner
router.post("/banners", async (req, res) => {
  try {
    const {
      title,
      subtitle,
      cta = "Shop Now",
      ctaLink = "/products",
      image = "",
      bgGradient = "from-indigo-600 to-purple-700",
      isActive = true,
      order,
    } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ message: "Banner title is required." });
    }

    const sortOrder = order !== undefined ? parseInt(order, 10) : 1;

    const { rows } = await db.query(
      `INSERT INTO hero_banners 
        (title, subtitle, cta, cta_link, image, bg_gradient, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        title.trim(),
        subtitle?.trim() || "",
        cta.trim(),
        ctaLink.trim(),
        image.trim(),
        bgGradient.trim(),
        Boolean(isActive),
        sortOrder,
      ]
    );

    res.status(201).json({
      success: true,
      message: "Banner created successfully!",
      banner: mapBanner(rows[0]),
    });
  } catch (err) {
    console.error("Error creating banner:", err);
    res.status(500).json({ message: "Failed to create banner.", error: err.message });
  }
});

// PUT update banner
router.put("/banners/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      subtitle,
      cta,
      ctaLink,
      image,
      bgGradient,
      isActive,
      order,
    } = req.body;

    const { rows } = await db.query(
      `UPDATE hero_banners 
       SET title = COALESCE($1, title),
           subtitle = COALESCE($2, subtitle),
           cta = COALESCE($3, cta),
           cta_link = COALESCE($4, cta_link),
           image = COALESCE($5, image),
           bg_gradient = COALESCE($6, bg_gradient),
           is_active = COALESCE($7, is_active),
           sort_order = COALESCE($8, sort_order)
       WHERE id = $9
       RETURNING *`,
      [
        title?.trim(),
        subtitle !== undefined ? subtitle.trim() : null,
        cta?.trim(),
        ctaLink?.trim(),
        image !== undefined ? image.trim() : null,
        bgGradient?.trim(),
        isActive !== undefined ? Boolean(isActive) : null,
        order !== undefined ? parseInt(order, 10) : null,
        id,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Banner not found." });
    }

    res.json({
      success: true,
      message: "Banner updated successfully!",
      banner: mapBanner(rows[0]),
    });
  } catch (err) {
    console.error("Error updating banner:", err);
    res.status(500).json({ message: "Failed to update banner.", error: err.message });
  }
});

// PATCH toggle banner active state
router.patch("/banners/:id/toggle", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(
      `UPDATE hero_banners 
       SET is_active = NOT is_active 
       WHERE id = $1 
       RETURNING *`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Banner not found." });
    }

    res.json({
      success: true,
      banner: mapBanner(rows[0]),
    });
  } catch (err) {
    console.error("Error toggling banner:", err);
    res.status(500).json({ message: "Failed to toggle banner.", error: err.message });
  }
});

// DELETE banner
router.delete("/banners/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await db.query("DELETE FROM hero_banners WHERE id = $1", [id]);

    if (rowCount === 0) {
      return res.status(404).json({ message: "Banner not found." });
    }

    res.json({ success: true, message: "Banner deleted successfully." });
  } catch (err) {
    console.error("Error deleting banner:", err);
    res.status(500).json({ message: "Failed to delete banner.", error: err.message });
  }
});

export default router;

import express from "express";
import db from "../config/db.js";
import upload from "../middleware/upload.js";

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

// POST upload banner image (via Cloudinary or file)
router.post("/upload", (req, res) => {
  upload.single("image")(req, res, (err) => {
    if (err) {
      console.error("Banner upload error:", err);
      return res.status(400).json({ success: false, message: err.message || "Failed to upload image." });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No image file provided." });
    }
    const imageUrl = req.file.path || req.file.secure_url || req.file.url;
    res.json({
      success: true,
      message: "Image uploaded successfully!",
      url: imageUrl,
    });
  });
});

// GET product images for quick selection in banner CMS
router.get("/product-images", async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT id, name, category, image FROM products WHERE image IS NOT NULL AND image != '' ORDER BY id DESC LIMIT 50"
    );
    res.json(rows);
  } catch (err) {
    console.error("Error fetching product images for CMS:", err);
    res.status(500).json({ message: "Failed to fetch product images." });
  }
});

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

// ── ANNOUNCEMENT BARS CMS ──────────────────────────────────────────────────

function mapAnnouncement(row) {
  return {
    id: row.id,
    text: row.text,
    badge: row.badge || "",
    link: row.link || "",
    ctaText: row.cta_text || "Shop Now",
    icon: row.icon || "🎉",
    image: row.image || "",
    bgColor: row.bg_color || "linear-gradient(90deg, #15803d, #22c55e)",
    textColor: row.text_color || "#ffffff",
    isActive: Boolean(row.is_active),
    order: Number(row.sort_order || 1),
    createdAt: row.created_at,
  };
}

// GET all announcement bars (optional ?activeOnly=true)
router.get("/announcements", async (req, res) => {
  try {
    const { activeOnly } = req.query;
    let queryStr = "SELECT * FROM announcement_bars";
    if (activeOnly === "true") {
      queryStr += " WHERE is_active = TRUE";
    }
    queryStr += " ORDER BY is_active DESC, sort_order ASC, id ASC";

    const { rows } = await db.query(queryStr);
    res.json(rows.map(mapAnnouncement));
  } catch (err) {
    console.error("Error fetching announcements:", err);
    res.status(500).json({ message: "Failed to fetch announcements.", error: err.message });
  }
});

// POST create announcement
router.post("/announcements", async (req, res) => {
  try {
    const {
      text,
      badge = "",
      link = "/deals",
      ctaText = "Shop Now",
      icon = "🎉",
      image = "",
      bgColor = "linear-gradient(90deg, #15803d, #22c55e)",
      textColor = "#ffffff",
      isActive = false,
      order = 1,
    } = req.body;

    if (!text?.trim()) {
      return res.status(400).json({ message: "Announcement text is required." });
    }

    // If marked active, deactivate other announcement bars to ensure only 1 active at a time
    if (isActive) {
      await db.query("UPDATE announcement_bars SET is_active = FALSE");
    }

    const { rows } = await db.query(
      `INSERT INTO announcement_bars 
        (text, badge, link, cta_text, icon, image, bg_color, text_color, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        text.trim(),
        badge?.trim() || "",
        link?.trim() || "",
        ctaText?.trim() || "",
        icon?.trim() || "🎉",
        image?.trim() || "",
        bgColor?.trim() || "linear-gradient(90deg, #15803d, #22c55e)",
        textColor?.trim() || "#ffffff",
        Boolean(isActive),
        parseInt(order, 10) || 1,
      ]
    );

    res.status(201).json({
      success: true,
      message: "Announcement created successfully!",
      announcement: mapAnnouncement(rows[0]),
    });
  } catch (err) {
    console.error("Error creating announcement:", err);
    res.status(500).json({ message: "Failed to create announcement.", error: err.message });
  }
});

// PUT update announcement
router.put("/announcements/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      text,
      badge,
      link,
      ctaText,
      icon,
      image,
      bgColor,
      textColor,
      isActive,
      order,
    } = req.body;

    if (isActive) {
      // Deactivate all others
      await db.query("UPDATE announcement_bars SET is_active = FALSE WHERE id != $1", [id]);
    }

    const { rows } = await db.query(
      `UPDATE announcement_bars
       SET text = COALESCE($1, text),
           badge = COALESCE($2, badge),
           link = COALESCE($3, link),
           cta_text = COALESCE($4, cta_text),
           icon = COALESCE($5, icon),
           image = COALESCE($6, image),
           bg_color = COALESCE($7, bg_color),
           text_color = COALESCE($8, text_color),
           is_active = COALESCE($9, is_active),
           sort_order = COALESCE($10, sort_order),
           updated_at = NOW()
       WHERE id = $11
       RETURNING *`,
      [
        text?.trim(),
        badge !== undefined ? badge.trim() : null,
        link !== undefined ? link.trim() : null,
        ctaText !== undefined ? ctaText.trim() : null,
        icon !== undefined ? icon.trim() : null,
        image !== undefined ? image.trim() : null,
        bgColor !== undefined ? bgColor.trim() : null,
        textColor !== undefined ? textColor.trim() : null,
        isActive !== undefined ? Boolean(isActive) : null,
        order !== undefined ? parseInt(order, 10) : null,
        id,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Announcement not found." });
    }

    res.json({
      success: true,
      message: "Announcement updated successfully!",
      announcement: mapAnnouncement(rows[0]),
    });
  } catch (err) {
    console.error("Error updating announcement:", err);
    res.status(500).json({ message: "Failed to update announcement.", error: err.message });
  }
});

// PATCH toggle announcement active state (ensures only 1 active)
router.patch("/announcements/:id/toggle", async (req, res) => {
  try {
    const { id } = req.params;
    const current = await db.query("SELECT is_active FROM announcement_bars WHERE id = $1", [id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ message: "Announcement not found." });
    }

    const willBeActive = !current.rows[0].is_active;

    if (willBeActive) {
      // Deactivate all others
      await db.query("UPDATE announcement_bars SET is_active = FALSE");
    }

    const { rows } = await db.query(
      `UPDATE announcement_bars SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [willBeActive, id]
    );

    res.json({
      success: true,
      announcement: mapAnnouncement(rows[0]),
    });
  } catch (err) {
    console.error("Error toggling announcement:", err);
    res.status(500).json({ message: "Failed to toggle announcement.", error: err.message });
  }
});

// DELETE announcement
router.delete("/announcements/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await db.query("DELETE FROM announcement_bars WHERE id = $1", [id]);
    if (rowCount === 0) {
      return res.status(404).json({ message: "Announcement not found." });
    }
    res.json({ success: true, message: "Announcement deleted successfully." });
  } catch (err) {
    console.error("Error deleting announcement:", err);
    res.status(500).json({ message: "Failed to delete announcement.", error: err.message });
  }
});

function mapFeaturedSection(row) {
  let productIds = [];
  try {
    if (Array.isArray(row.product_ids)) {
      productIds = row.product_ids;
    } else if (typeof row.product_ids === "string") {
      productIds = JSON.parse(row.product_ids || "[]");
    }
  } catch {
    productIds = [];
  }

  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle || "",
    badge: row.badge || "",
    productIds: productIds,
    category: row.category || "All",
    layoutType: row.layout_type || "grid",
    maxItems: Number(row.max_items || 8),
    isActive: Boolean(row.is_active),
    order: Number(row.sort_order || 1),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// GET all featured sections (supports ?activeOnly=true)
router.get("/featured-sections", async (req, res) => {
  try {
    const { activeOnly } = req.query;
    let query = "SELECT * FROM featured_sections";
    const params = [];

    if (activeOnly === "true") {
      query += " WHERE is_active = TRUE";
    }

    query += " ORDER BY sort_order ASC, id ASC";
    const { rows } = await db.query(query, params);
    res.json(rows.map(mapFeaturedSection));
  } catch (err) {
    console.error("Error fetching featured sections:", err);
    res.status(500).json({ message: "Failed to fetch featured sections.", error: err.message });
  }
});

// POST create featured section
router.post("/featured-sections", async (req, res) => {
  try {
    const {
      title,
      subtitle = "",
      badge = "TOP PICKS",
      productIds = [],
      category = "All",
      layoutType = "grid",
      maxItems = 8,
      isActive = true,
      order = 1,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: "Section title is required." });
    }

    const { rows } = await db.query(
      `INSERT INTO featured_sections 
        (title, subtitle, badge, product_ids, category, layout_type, max_items, is_active, sort_order)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        title.trim(),
        subtitle,
        badge,
        JSON.stringify(Array.isArray(productIds) ? productIds : []),
        category,
        layoutType,
        parseInt(maxItems, 10) || 8,
        Boolean(isActive),
        parseInt(order, 10) || 1,
      ]
    );

    res.status(201).json({
      success: true,
      message: "Featured section created successfully!",
      section: mapFeaturedSection(rows[0]),
    });
  } catch (err) {
    console.error("Error creating featured section:", err);
    res.status(500).json({ message: "Failed to create featured section.", error: err.message });
  }
});

// PUT update featured section
router.put("/featured-sections/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      subtitle,
      badge,
      productIds,
      category,
      layoutType,
      maxItems,
      isActive,
      order,
    } = req.body;

    const { rows } = await db.query(
      `UPDATE featured_sections SET
        title = COALESCE($1, title),
        subtitle = COALESCE($2, subtitle),
        badge = COALESCE($3, badge),
        product_ids = COALESCE($4::jsonb, product_ids),
        category = COALESCE($5, category),
        layout_type = COALESCE($6, layout_type),
        max_items = COALESCE($7, max_items),
        is_active = COALESCE($8, is_active),
        sort_order = COALESCE($9, sort_order),
        updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [
        title !== undefined ? title.trim() : null,
        subtitle !== undefined ? subtitle : null,
        badge !== undefined ? badge : null,
        productIds !== undefined ? JSON.stringify(productIds) : null,
        category !== undefined ? category : null,
        layoutType !== undefined ? layoutType : null,
        maxItems !== undefined ? parseInt(maxItems, 10) : null,
        isActive !== undefined ? Boolean(isActive) : null,
        order !== undefined ? parseInt(order, 10) : null,
        id,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Featured section not found." });
    }

    res.json({
      success: true,
      message: "Featured section updated successfully!",
      section: mapFeaturedSection(rows[0]),
    });
  } catch (err) {
    console.error("Error updating featured section:", err);
    res.status(500).json({ message: "Failed to update featured section.", error: err.message });
  }
});

// PATCH toggle active state
router.patch("/featured-sections/:id/toggle", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(
      `UPDATE featured_sections 
       SET is_active = NOT is_active, updated_at = NOW() 
       WHERE id = $1 
       RETURNING *`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Featured section not found." });
    }

    res.json({
      success: true,
      section: mapFeaturedSection(rows[0]),
    });
  } catch (err) {
    console.error("Error toggling featured section:", err);
    res.status(500).json({ message: "Failed to toggle featured section.", error: err.message });
  }
});

// DELETE featured section
router.delete("/featured-sections/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await db.query("DELETE FROM featured_sections WHERE id = $1", [id]);
    if (rowCount === 0) {
      return res.status(404).json({ message: "Featured section not found." });
    }
    res.json({ success: true, message: "Featured section deleted successfully." });
  } catch (err) {
    console.error("Error deleting featured section:", err);
    res.status(500).json({ message: "Failed to delete featured section.", error: err.message });
  }
});

export default router;

import express from "express";
import db from "../config/db.js";

const router = express.Router();

function mapZone(row) {
  return {
    id: row.id,
    name: row.name,
    areas: row.areas || "",
    deliveryDays: row.delivery_days || "3-5",
    standardRate: Number(row.standard_rate || 0),
    expressRate: Number(row.express_rate || 0),
    freeAbove: Number(row.free_above || 999),
    isActive: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapPartner(row) {
  return {
    id: row.id,
    name: row.name,
    logo: row.logo || "🚚",
    status: row.status || "Connected",
    trackingSupport: Boolean(row.tracking_support),
    apiKey: row.api_key || "",
    accountId: row.account_id || "",
    trackingUrl: row.tracking_url || "",
    created_at: row.created_at,
  };
}

function mapSettings(row) {
  if (!row) {
    return {
      freeShippingThreshold: 999,
      defaultStandardRate: 49,
      defaultExpressRate: 99,
      codCharges: 40,
      enableCod: true,
      enableExpress: true,
      estimatedDays: "3-5 business days",
      shippingPolicy: "Free shipping on orders above ₹999. Standard delivery takes 3-5 business days across India.",
    };
  }
  return {
    id: row.id,
    freeShippingThreshold: Number(row.free_shipping_threshold ?? 999),
    defaultStandardRate: Number(row.default_standard_rate ?? 49),
    defaultExpressRate: Number(row.default_express_rate ?? 99),
    codCharges: Number(row.cod_charges ?? 40),
    enableCod: Boolean(row.enable_cod),
    enableExpress: Boolean(row.enable_express),
    estimatedDays: row.estimated_days || "3-5 business days",
    shippingPolicy: row.shipping_policy || "",
    updated_at: row.updated_at,
  };
}

/* ==========================================================
   SHIPPING ZONES
========================================================== */

// GET all shipping zones (optionally ?activeOnly=true)
router.get("/zones", async (req, res) => {
  try {
    const { activeOnly } = req.query;
    let queryStr = "SELECT * FROM shipping_zones";
    if (activeOnly === "true") {
      queryStr += " WHERE is_active = TRUE";
    }
    queryStr += " ORDER BY id ASC";

    const { rows } = await db.query(queryStr);
    res.json(rows.map(mapZone));
  } catch (err) {
    console.error("Error fetching shipping zones:", err);
    res.status(500).json({ message: "Failed to fetch shipping zones.", error: err.message });
  }
});

// POST create a shipping zone
router.post("/zones", async (req, res) => {
  try {
    const {
      name,
      areas = "",
      deliveryDays = "3-5",
      standardRate = 49,
      expressRate = 99,
      freeAbove = 999,
      isActive = true,
    } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ message: "Zone name is required." });
    }

    const { rows } = await db.query(
      `INSERT INTO shipping_zones 
        (name, areas, delivery_days, standard_rate, express_rate, free_above, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        name.trim(),
        areas.trim(),
        deliveryDays.trim(),
        Number(standardRate) || 0,
        Number(expressRate) || 0,
        Number(freeAbove) || 0,
        Boolean(isActive),
      ]
    );

    res.status(201).json({
      success: true,
      message: "Shipping zone created successfully!",
      zone: mapZone(rows[0]),
    });
  } catch (err) {
    console.error("Error creating shipping zone:", err);
    res.status(500).json({ message: "Failed to create shipping zone.", error: err.message });
  }
});

// PUT update a shipping zone
router.put("/zones/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      areas,
      deliveryDays,
      standardRate,
      expressRate,
      freeAbove,
      isActive,
    } = req.body;

    const { rows } = await db.query(
      `UPDATE shipping_zones
       SET name = COALESCE($1, name),
           areas = COALESCE($2, areas),
           delivery_days = COALESCE($3, delivery_days),
           standard_rate = COALESCE($4, standard_rate),
           express_rate = COALESCE($5, express_rate),
           free_above = COALESCE($6, free_above),
           is_active = COALESCE($7, is_active),
           updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        name !== undefined ? name.trim() : null,
        areas !== undefined ? areas.trim() : null,
        deliveryDays !== undefined ? deliveryDays.trim() : null,
        standardRate !== undefined ? Number(standardRate) : null,
        expressRate !== undefined ? Number(expressRate) : null,
        freeAbove !== undefined ? Number(freeAbove) : null,
        isActive !== undefined ? Boolean(isActive) : null,
        id,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Shipping zone not found." });
    }

    res.json({
      success: true,
      message: "Shipping zone updated successfully!",
      zone: mapZone(rows[0]),
    });
  } catch (err) {
    console.error("Error updating shipping zone:", err);
    res.status(500).json({ message: "Failed to update shipping zone.", error: err.message });
  }
});

// PATCH toggle shipping zone active status
router.patch("/zones/:id/toggle", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(
      `UPDATE shipping_zones
       SET is_active = NOT is_active,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Shipping zone not found." });
    }

    res.json({
      success: true,
      message: `Zone is now ${rows[0].is_active ? "Active" : "Inactive"}.`,
      zone: mapZone(rows[0]),
    });
  } catch (err) {
    console.error("Error toggling shipping zone:", err);
    res.status(500).json({ message: "Failed to toggle shipping zone.", error: err.message });
  }
});

// DELETE a shipping zone
router.delete("/zones/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await db.query("DELETE FROM shipping_zones WHERE id = $1", [id]);

    if (rowCount === 0) {
      return res.status(404).json({ message: "Shipping zone not found." });
    }

    res.json({ success: true, message: "Shipping zone deleted successfully." });
  } catch (err) {
    console.error("Error deleting shipping zone:", err);
    res.status(500).json({ message: "Failed to delete shipping zone.", error: err.message });
  }
});

/* ==========================================================
   DELIVERY PARTNERS
========================================================== */

// GET all delivery partners
router.get("/partners", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM delivery_partners ORDER BY id ASC");
    res.json(rows.map(mapPartner));
  } catch (err) {
    console.error("Error fetching delivery partners:", err);
    res.status(500).json({ message: "Failed to fetch delivery partners.", error: err.message });
  }
});

// POST create delivery partner
router.post("/partners", async (req, res) => {
  try {
    const {
      name,
      logo = "🚚",
      status = "Connected",
      trackingSupport = true,
      apiKey = "",
      accountId = "",
      trackingUrl = "",
    } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ message: "Partner name is required." });
    }

    const { rows } = await db.query(
      `INSERT INTO delivery_partners (name, logo, status, tracking_support, api_key, account_id, tracking_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        name.trim(),
        logo.trim() || "🚚",
        status.trim() || "Connected",
        Boolean(trackingSupport),
        apiKey?.trim() || "",
        accountId?.trim() || "",
        trackingUrl?.trim() || "",
      ]
    );

    res.status(201).json({
      success: true,
      message: "Delivery partner added successfully!",
      partner: mapPartner(rows[0]),
    });
  } catch (err) {
    console.error("Error creating delivery partner:", err);
    res.status(500).json({ message: "Failed to add delivery partner.", error: err.message });
  }
});

// PUT update delivery partner
router.put("/partners/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, logo, status, trackingSupport, apiKey, accountId, trackingUrl } = req.body;

    const { rows } = await db.query(
      `UPDATE delivery_partners
       SET name = COALESCE($1, name),
           logo = COALESCE($2, logo),
           status = COALESCE($3, status),
           tracking_support = COALESCE($4, tracking_support),
           api_key = COALESCE($5, api_key),
           account_id = COALESCE($6, account_id),
           tracking_url = COALESCE($7, tracking_url)
       WHERE id = $8
       RETURNING *`,
      [
        name !== undefined ? name.trim() : null,
        logo !== undefined ? logo.trim() : null,
        status !== undefined ? status.trim() : null,
        trackingSupport !== undefined ? Boolean(trackingSupport) : null,
        apiKey !== undefined ? apiKey.trim() : null,
        accountId !== undefined ? accountId.trim() : null,
        trackingUrl !== undefined ? trackingUrl.trim() : null,
        id,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Delivery partner not found." });
    }

    res.json({
      success: true,
      message: "Delivery partner updated successfully!",
      partner: mapPartner(rows[0]),
    });
  } catch (err) {
    console.error("Error updating delivery partner:", err);
    res.status(500).json({ message: "Failed to update delivery partner.", error: err.message });
  }
});

// PATCH toggle partner connected/disconnected status
router.patch("/partners/:id/toggle", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(
      `UPDATE delivery_partners
       SET status = CASE WHEN status = 'Connected' THEN 'Disconnected' ELSE 'Connected' END
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Delivery partner not found." });
    }

    res.json({
      success: true,
      message: `Partner is now ${rows[0].status}.`,
      partner: mapPartner(rows[0]),
    });
  } catch (err) {
    console.error("Error toggling delivery partner:", err);
    res.status(500).json({ message: "Failed to toggle delivery partner.", error: err.message });
  }
});

// DELETE delivery partner
router.delete("/partners/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await db.query("DELETE FROM delivery_partners WHERE id = $1", [id]);

    if (rowCount === 0) {
      return res.status(404).json({ message: "Delivery partner not found." });
    }

    res.json({ success: true, message: "Delivery partner deleted successfully." });
  } catch (err) {
    console.error("Error deleting delivery partner:", err);
    res.status(500).json({ message: "Failed to delete delivery partner.", error: err.message });
  }
});

/* ==========================================================
   GLOBAL SETTINGS
========================================================== */

// GET shipping global settings
router.get("/settings", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM shipping_settings ORDER BY id ASC LIMIT 1");
    if (rows.length === 0) {
      // Create initial row
      const initRes = await db.query(`
        INSERT INTO shipping_settings 
          (free_shipping_threshold, default_standard_rate, default_express_rate, cod_charges, enable_cod, enable_express, estimated_days, shipping_policy)
        VALUES (999, 49, 99, 40, TRUE, TRUE, '3-5 business days', 'Free shipping on all orders above ₹999. Standard delivery takes 3-5 business days across India.')
        RETURNING *
      `);
      return res.json(mapSettings(initRes.rows[0]));
    }
    res.json(mapSettings(rows[0]));
  } catch (err) {
    console.error("Error fetching shipping settings:", err);
    res.status(500).json({ message: "Failed to fetch shipping settings.", error: err.message });
  }
});

// PUT update shipping global settings
router.put("/settings", async (req, res) => {
  try {
    const {
      freeShippingThreshold,
      defaultStandardRate,
      defaultExpressRate,
      codCharges,
      enableCod,
      enableExpress,
      estimatedDays,
      shippingPolicy,
    } = req.body;

    const { rows } = await db.query(
      `UPDATE shipping_settings
       SET free_shipping_threshold = COALESCE($1, free_shipping_threshold),
           default_standard_rate = COALESCE($2, default_standard_rate),
           default_express_rate = COALESCE($3, default_express_rate),
           cod_charges = COALESCE($4, cod_charges),
           enable_cod = COALESCE($5, enable_cod),
           enable_express = COALESCE($6, enable_express),
           estimated_days = COALESCE($7, estimated_days),
           shipping_policy = COALESCE($8, shipping_policy),
           updated_at = NOW()
       WHERE id = (SELECT id FROM shipping_settings ORDER BY id ASC LIMIT 1)
       RETURNING *`,
      [
        freeShippingThreshold !== undefined ? Number(freeShippingThreshold) : null,
        defaultStandardRate !== undefined ? Number(defaultStandardRate) : null,
        defaultExpressRate !== undefined ? Number(defaultExpressRate) : null,
        codCharges !== undefined ? Number(codCharges) : null,
        enableCod !== undefined ? Boolean(enableCod) : null,
        enableExpress !== undefined ? Boolean(enableExpress) : null,
        estimatedDays !== undefined ? estimatedDays.trim() : null,
        shippingPolicy !== undefined ? shippingPolicy.trim() : null,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Shipping settings not found." });
    }

    res.json({
      success: true,
      message: "Shipping settings updated successfully!",
      settings: mapSettings(rows[0]),
    });
  } catch (err) {
    console.error("Error updating shipping settings:", err);
    res.status(500).json({ message: "Failed to update shipping settings.", error: err.message });
  }
});

/* ==========================================================
   CALCULATE SHIPPING FOR CHECKOUT & CART
========================================================== */
router.post("/calculate", async (req, res) => {
  try {
    const { city = "", state = "", pincode = "", subtotal = 0 } = req.body;
    const numSubtotal = Number(subtotal) || 0;

    // 1. Fetch settings
    const { rows: settingsRows } = await db.query("SELECT * FROM shipping_settings LIMIT 1");
    const settings = mapSettings(settingsRows[0]);

    // 2. Fetch active zones
    const { rows: zoneRows } = await db.query("SELECT * FROM shipping_zones WHERE is_active = TRUE ORDER BY id ASC");
    const zones = zoneRows.map(mapZone);

    let matchedZone = null;
    const searchTarget = `${city} ${state} ${pincode}`.toLowerCase();

    for (const z of zones) {
      const areaList = z.areas.toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
      for (const area of areaList) {
        if (
          (city && area.includes(city.toLowerCase())) ||
          (state && area.includes(state.toLowerCase())) ||
          (pincode && area.includes(pincode.trim())) ||
          searchTarget.includes(area)
        ) {
          matchedZone = z;
          break;
        }
      }
      if (matchedZone) break;
    }

    // Default zone if no specific zone matched
    if (!matchedZone) {
      // Find "Rest of India" or general zone if present
      matchedZone = zones.find((z) => z.name.toLowerCase().includes("rest of india")) || {
        name: "Standard Shipping",
        deliveryDays: settings.estimatedDays,
        standardRate: settings.defaultStandardRate,
        expressRate: settings.defaultExpressRate,
        freeAbove: settings.freeShippingThreshold,
      };
    }

    const freeThreshold = matchedZone.freeAbove || settings.freeShippingThreshold;
    const isFree = numSubtotal >= freeThreshold;
    const standardRate = isFree ? 0 : matchedZone.standardRate;
    const expressRate = settings.enableExpress ? matchedZone.expressRate : null;

    res.json({
      success: true,
      zoneName: matchedZone.name,
      deliveryDays: matchedZone.deliveryDays,
      standardRate,
      expressRate,
      isFree,
      freeThreshold,
      codCharges: settings.enableCod ? settings.codCharges : 0,
      enableCod: settings.enableCod,
      enableExpress: settings.enableExpress,
    });
  } catch (err) {
    console.error("Error calculating shipping:", err);
    res.status(500).json({ message: "Failed to calculate shipping.", error: err.message });
  }
});

export default router;

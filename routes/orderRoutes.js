import express from "express";
import db from "../config/db.js";
import { verifyAdmin } from "../middleware/authMiddleware.js";
import { createOrderInDB } from "../services/orderService.js";

const router = express.Router();

// GET all orders (admin only) — supports optional ?status= filter and ?search=
router.get("/", verifyAdmin, async (req, res) => {
  const { status, search } = req.query;
  try {
    let query = `
      SELECT
        o.*,
        (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
      FROM orders o
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== "All") {
      params.push(status);
      query += ` AND o.status = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      const idx1 = params.length;
      params.push(`%${search}%`);
      const idx2 = params.length;
      query += ` AND (o.order_number ILIKE $${idx1} OR o.customer_name ILIKE $${idx2})`;
    }

    query += " ORDER BY o.created_at DESC";

    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch orders.", error: err.message });
  }
});

// GET recent orders (for dashboard widget)
router.get("/recent", verifyAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT * FROM orders ORDER BY created_at DESC LIMIT 5"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch recent orders.", error: err.message });
  }
});

// GET order by order_number (public — for track order page, no auth)
// IMPORTANT: this must come BEFORE "/:id" or Express will try to match
// "track" itself as an :id value.
router.get("/track/:orderNumber", async (req, res) => {
  try {
    let orderNumber = req.params.orderNumber.trim();
    if (!orderNumber.startsWith("#")) orderNumber = "#" + orderNumber;

    const { rows: orderRows } = await db.query(
      "SELECT * FROM orders WHERE order_number = $1",
      [orderNumber]
    );
    if (orderRows.length === 0) {
      return res.status(404).json({ message: "Order not found." });
    }

    const { rows: itemRows } = await db.query(
      "SELECT * FROM order_items WHERE order_id = $1",
      [orderRows[0].id]
    );

    res.json({ ...orderRows[0], items: itemRows });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch order.", error: err.message });
  }
});

// GET single order with its items (admin only)
router.get("/:id", verifyAdmin, async (req, res) => {
  try {
    const { rows: orderRows } = await db.query("SELECT * FROM orders WHERE id = $1", [
      req.params.id,
    ]);
    if (orderRows.length === 0) {
      return res.status(404).json({ message: "Order not found." });
    }

    const { rows: itemRows } = await db.query(
      "SELECT * FROM order_items WHERE order_id = $1",
      [req.params.id]
    );

    res.json({ ...orderRows[0], items: itemRows });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch order.", error: err.message });
  }
});

// CREATE order — COD checkout only. Online payment orders are created
// via paymentRoutes.js after payment verification succeeds.
router.post("/", async (req, res) => {
  const {
    customer_id,
    customer_name,
    customer_email,
    customer_phone,
    shipping_phone,
    shipping_address,
    shipping_city,
    shipping_state,
    shipping_pincode,
    items,
    total_amount,
  } = req.body;

  if (!customer_name || !items || items.length === 0) {
    return res.status(400).json({ message: "Customer name and at least one item are required." });
  }

  // Handle both flat and nested address formats
  const finalPhone = shipping_phone || customer_phone || (typeof shipping_address === "object" ? shipping_address?.phone : null);
  const finalAddress = typeof shipping_address === "object" ? shipping_address.address : shipping_address;
  const finalCity = typeof shipping_address === "object" ? shipping_address.city : shipping_city;
  const finalState = typeof shipping_address === "object" ? shipping_address.state : shipping_state;
  const finalPincode = typeof shipping_address === "object" ? shipping_address.pincode : shipping_pincode;

  if (!finalPhone || !finalAddress || !finalCity || !finalPincode) {
    return res.status(400).json({ message: "Complete shipping address is required." });
  }

  try {
    const result = await createOrderInDB({
      customer_id,
      customer_name,
      customer_email,
      payment_method: "COD",
      payment_status: "Pending",
      shipping_phone: finalPhone,
      shipping_address: finalAddress,
      shipping_city: finalCity,
      shipping_state: finalState || "",
      shipping_pincode: finalPincode,
      items,
      total_amount,
    });

    res.status(201).json({ message: "Order placed successfully.", ...result });
  } catch (err) {
    res.status(500).json({ message: "Failed to create order.", error: err.message });
  }
});

// UPDATE order status (admin only)
router.put("/:id/status", verifyAdmin, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ["Pending", "Shipped", "Delivered", "Cancelled"];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ message: "Invalid status value." });
  }

  try {
    const result = await db.query("UPDATE orders SET status = $1 WHERE id = $2", [
      status,
      req.params.id,
    ]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Order not found." });
    }
    res.json({ message: "Order status updated successfully." });
  } catch (err) {
    res.status(500).json({ message: "Failed to update order status.", error: err.message });
  }
});

// DELETE order (admin only)
router.delete("/:id", verifyAdmin, async (req, res) => {
  try {
    const result = await db.query("DELETE FROM orders WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Order not found." });
    }
    res.json({ message: "Order deleted successfully." });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete order.", error: err.message });
  }
});

export default router;
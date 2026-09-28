import express from "express";
import db from "../config/db.js";
import { verifyAdmin, requirePermission } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * GET /api/admin/customers
 * Returns all registered customers along with real aggregate order metrics from the database
 */
router.get("/", verifyAdmin, requirePermission(["customers.view", "customers.manage"]), async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        u.id, 
        u.name, 
        u.email, 
        u.phone, 
        u.is_verified, 
        u.created_at,
        COUNT(o.id)::integer AS total_orders,
        COALESCE(SUM(CASE WHEN o.status != 'Cancelled' THEN o.total_amount ELSE 0 END), 0)::numeric AS total_spent,
        COALESCE(SUM(CASE WHEN o.status = 'Pending' OR o.status = 'Processing' THEN 1 ELSE 0 END), 0)::integer AS pending_orders,
        COALESCE(SUM(CASE WHEN o.status = 'Delivered' THEN 1 ELSE 0 END), 0)::integer AS delivered_orders,
        MAX(o.created_at) AS last_order_date
      FROM users u
      LEFT JOIN orders o ON (o.customer_id = u.id OR (o.customer_email IS NOT NULL AND LOWER(o.customer_email) = LOWER(u.email)))
      GROUP BY u.id, u.name, u.email, u.phone, u.is_verified, u.created_at
      ORDER BY u.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error("Customers list error:", err);
    res.status(500).json({ message: "Failed to fetch customers.", error: err.message });
  }
});

/**
 * GET /api/admin/customers/:id
 * Returns complete real details of a specific customer, including summary stats and all order history with items
 */
router.get("/:id", verifyAdmin, requirePermission(["customers.view", "customers.manage"]), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: userRows } = await db.query(
      "SELECT id, name, email, phone, is_verified, created_at FROM users WHERE id = $1",
      [id]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ message: "Customer not found." });
    }

    const user = userRows[0];

    // Fetch all real orders belonging to this customer (by customer_id or matching customer_email)
    const { rows: orders } = await db.query(
      `SELECT 
        o.id,
        o.order_number,
        o.customer_id,
        o.customer_name,
        o.customer_email,
        o.total_amount,
        o.status,
        o.payment_method,
        o.payment_status,
        o.shipping_phone,
        o.shipping_address,
        o.shipping_city,
        o.shipping_state,
        o.shipping_pincode,
        o.created_at,
        (
          SELECT COALESCE(json_agg(
            json_build_object(
              'id', oi.id,
              'product_id', oi.product_id,
              'product_name', oi.product_name,
              'quantity', oi.quantity,
              'price', oi.price
            )
          ), '[]'::json)
          FROM order_items oi
          WHERE oi.order_id = o.id
        ) AS items
      FROM orders o
      WHERE o.customer_id = $1 OR (o.customer_email IS NOT NULL AND LOWER(o.customer_email) = LOWER($2))
      ORDER BY o.created_at DESC`,
      [user.id, user.email]
    );

    const totalOrders = orders.length;
    const totalSpent = orders
      .filter((o) => o.status !== "Cancelled")
      .reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
    const deliveredCount = orders.filter((o) => o.status === "Delivered").length;
    const pendingCount = orders.filter((o) => o.status === "Pending" || o.status === "Processing").length;
    const shippedCount = orders.filter((o) => o.status === "Shipped").length;
    const cancelledCount = orders.filter((o) => o.status === "Cancelled").length;

    res.json({
      customer: user,
      metrics: {
        total_orders: totalOrders,
        total_spent: totalSpent,
        delivered_orders: deliveredCount,
        pending_orders: pendingCount,
        shipped_orders: shippedCount,
        cancelled_orders: cancelledCount,
        avg_order_value: totalOrders > 0 ? Math.round(totalSpent / totalOrders) : 0,
      },
      orders,
    });
  } catch (err) {
    console.error("Customer details error:", err);
    res.status(500).json({ message: "Failed to fetch customer details.", error: err.message });
  }
});

/**
 * PATCH /api/admin/customers/:id
 * Edit customer details or update verification status
 */
router.patch("/:id", verifyAdmin, requirePermission(["customers.edit", "customers.manage"]), async (req, res) => {
  const { id } = req.params;
  const { name, email, phone, is_verified } = req.body;
  try {
    const fields = [];
    const values = [];

    if (name !== undefined) {
      values.push(name.trim());
      fields.push(`name = $${values.length}`);
    }
    if (email !== undefined) {
      values.push(email.trim().toLowerCase());
      fields.push(`email = $${values.length}`);
    }
    if (phone !== undefined) {
      values.push(phone ? phone.trim() : null);
      fields.push(`phone = $${values.length}`);
    }
    if (is_verified !== undefined) {
      values.push(Boolean(is_verified));
      fields.push(`is_verified = $${values.length}`);
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: "No fields provided to update." });
    }

    values.push(id);
    const query = `UPDATE users SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING id, name, email, phone, is_verified, created_at`;
    const { rows } = await db.query(query, values);

    if (rows.length === 0) {
      return res.status(404).json({ message: "Customer not found." });
    }

    res.json({ success: true, message: "Customer updated successfully.", customer: rows[0] });
  } catch (err) {
    console.error("Update customer error:", err);
    res.status(500).json({ message: "Failed to update customer.", error: err.message });
  }
});

/**
 * DELETE /api/admin/customers/:id
 * Delete customer (especially pending/test/unverified accounts)
 */
router.delete("/:id", verifyAdmin, requirePermission(["customers.delete", "customers.manage"]), async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Check if user exists
    const { rows: existing } = await db.query("SELECT id, name, email FROM users WHERE id = $1", [id]);
    if (existing.length === 0) {
      return res.status(404).json({ message: "Customer not found." });
    }

    // 2. Unlink any orders customer_id to null so order history isn't corrupted
    await db.query("UPDATE orders SET customer_id = NULL WHERE customer_id = $1", [id]);

    // 3. Delete customer from users table
    await db.query("DELETE FROM users WHERE id = $1", [id]);

    res.json({
      success: true,
      message: `Customer ${existing[0].name || existing[0].email} deleted successfully.`,
      deleted: existing[0],
    });
  } catch (err) {
    console.error("Delete customer error:", err);
    res.status(500).json({ message: "Failed to delete customer.", error: err.message });
  }
});

export default router;
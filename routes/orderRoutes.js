import express from "express";
import db from "../config/db.js";
import { verifyAdmin, requirePermission } from "../middleware/authMiddleware.js";
import { createOrderInDB } from "../services/orderService.js";

const router = express.Router();

// GET all orders (admin only — requires orders.view) — supports optional ?status=, ?search=, ?startDate=, ?endDate=
router.get("/", verifyAdmin, requirePermission("orders.view"), async (req, res) => {
  const { status, search, startDate, endDate } = req.query;
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

    if (startDate) {
      params.push(startDate);
      query += ` AND o.created_at >= $${params.length}::timestamp`;
    }

    if (endDate) {
      params.push(`${endDate} 23:59:59.999`);
      query += ` AND o.created_at <= $${params.length}::timestamp`;
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

// GET recent orders (for dashboard widget — requires dashboard.view or orders.view)
router.get("/recent", verifyAdmin, requirePermission(["dashboard.view", "orders.view"]), async (req, res) => {
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

    // Join with products to get image for each item
    const { rows: itemRows } = await db.query(
      `SELECT oi.*, p.image AS product_image, p.images AS product_images
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`,
      [orderRows[0].id]
    );

    res.json({ ...orderRows[0], items: itemRows });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch order.", error: err.message });
  }
});

// GET single order with its items (admin only — requires orders.view)
router.get("/:id", verifyAdmin, requirePermission("orders.view"), async (req, res) => {
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

// UPDATE order status (admin only — requires orders.edit)
router.put("/:id/status", verifyAdmin, requirePermission("orders.edit"), async (req, res) => {
  const { status, estimated_delivery } = req.body;
  const validStatuses = ["Pending", "Processing", "Shipped", "Delivered", "Cancelled"];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ message: "Invalid status value." });
  }

  try {
    const existing = await db.query("SELECT status FROM orders WHERE id = $1", [req.params.id]);
    if (existing.rowCount === 0) {
      return res.status(404).json({ message: "Order not found." });
    }
    const prevStatus = existing.rows[0].status;

    const result = await db.query(
      "UPDATE orders SET status = $1, estimated_delivery = COALESCE($2, estimated_delivery) WHERE id = $3",
      [status, estimated_delivery || null, req.params.id]
    );

    // If order was newly cancelled, return stock to inventory
    if (status === "Cancelled" && prevStatus !== "Cancelled") {
      const { rows: orderItems } = await db.query(
        "SELECT product_id, product_name, quantity FROM order_items WHERE order_id = $1",
        [req.params.id]
      );
      for (const it of orderItems) {
        const q = parseInt(it.quantity, 10) || 1;
        if (it.product_id) {
          await db.query(
            `UPDATE products
             SET stock = stock + $1,
                 status = CASE WHEN status = 'Out of Stock' THEN 'Active' ELSE status END
             WHERE id = $2`,
            [q, it.product_id]
          );
        } else if (it.product_name) {
          await db.query(
            `UPDATE products
             SET stock = stock + $1,
                 status = CASE WHEN status = 'Out of Stock' THEN 'Active' ELSE status END
             WHERE LOWER(TRIM(name)) = LOWER(TRIM($2))`,
            [q, it.product_name]
          );
        }
      }
    } else if (prevStatus === "Cancelled" && status !== "Cancelled") {
      // If order was uncancelled, deduct stock again
      const { rows: orderItems } = await db.query(
        "SELECT product_id, product_name, quantity FROM order_items WHERE order_id = $1",
        [req.params.id]
      );
      for (const it of orderItems) {
        const q = parseInt(it.quantity, 10) || 1;
        if (it.product_id) {
          await db.query(
            `UPDATE products
             SET stock = GREATEST(0, stock - $1),
                 status = CASE WHEN stock - $1 <= 0 THEN 'Out of Stock' ELSE status END
             WHERE id = $2`,
            [q, it.product_id]
          );
        } else if (it.product_name) {
          await db.query(
            `UPDATE products
             SET stock = GREATEST(0, stock - $1),
                 status = CASE WHEN stock - $1 <= 0 THEN 'Out of Stock' ELSE status END
             WHERE LOWER(TRIM(name)) = LOWER(TRIM($2))`,
            [q, it.product_name]
          );
        }
      }
    }

    res.json({ message: "Order status updated successfully." });
  } catch (err) {
    res.status(500).json({ message: "Failed to update order status.", error: err.message });
  }
});

// PUT update order details / payment details (admin only)
router.put("/:id", verifyAdmin, requirePermission(["orders.edit", "orders.manage"]), async (req, res) => {
  const { id } = req.params;
  const { customer_name, total_amount, payment_method, status, payment_status, shipping_phone } = req.body;

  try {
    const existing = await db.query("SELECT * FROM orders WHERE id = $1", [id]);
    if (existing.rowCount === 0) {
      return res.status(404).json({ message: "Order not found." });
    }

    const prevOrder = existing.rows[0];

    // If status is updated to or from Cancelled, adjust inventory
    if (status && status !== prevOrder.status) {
      if (status === "Cancelled" && prevOrder.status !== "Cancelled") {
        const { rows: orderItems } = await db.query(
          "SELECT product_id, product_name, quantity FROM order_items WHERE order_id = $1",
          [id]
        );
        for (const it of orderItems) {
          const q = parseInt(it.quantity, 10) || 1;
          if (it.product_id) {
            await db.query(
              `UPDATE products SET stock = stock + $1, status = CASE WHEN status = 'Out of Stock' THEN 'Active' ELSE status END WHERE id = $2`,
              [q, it.product_id]
            );
          } else if (it.product_name) {
            await db.query(
              `UPDATE products SET stock = stock + $1, status = CASE WHEN status = 'Out of Stock' THEN 'Active' ELSE status END WHERE LOWER(TRIM(name)) = LOWER(TRIM($2))`,
              [q, it.product_name]
            );
          }
        }
      } else if (prevOrder.status === "Cancelled" && status !== "Cancelled") {
        const { rows: orderItems } = await db.query(
          "SELECT product_id, product_name, quantity FROM order_items WHERE order_id = $1",
          [id]
        );
        for (const it of orderItems) {
          const q = parseInt(it.quantity, 10) || 1;
          if (it.product_id) {
            await db.query(
              `UPDATE products SET stock = GREATEST(0, stock - $1), status = CASE WHEN stock - $1 <= 0 THEN 'Out of Stock' ELSE status END WHERE id = $2`,
              [q, it.product_id]
            );
          } else if (it.product_name) {
            await db.query(
              `UPDATE products SET stock = GREATEST(0, stock - $1), status = CASE WHEN stock - $1 <= 0 THEN 'Out of Stock' ELSE status END WHERE LOWER(TRIM(name)) = LOWER(TRIM($2))`,
              [q, it.product_name]
            );
          }
        }
      }
    }

    const { rows } = await db.query(
      `UPDATE orders SET
        customer_name = COALESCE($1, customer_name),
        total_amount = COALESCE($2, total_amount),
        payment_method = COALESCE($3, payment_method),
        status = COALESCE($4, status),
        payment_status = COALESCE($5, payment_status),
        shipping_phone = COALESCE($6, shipping_phone),
        updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [
        customer_name !== undefined ? customer_name.trim() : null,
        total_amount !== undefined ? parseFloat(total_amount) : null,
        payment_method !== undefined ? payment_method : null,
        status !== undefined ? status : null,
        payment_status !== undefined ? payment_status : null,
        shipping_phone !== undefined ? shipping_phone : null,
        id,
      ]
    );

    res.json({
      success: true,
      message: "Order & Payment updated successfully!",
      order: rows[0],
    });
  } catch (err) {
    console.error("Error updating order:", err);
    res.status(500).json({ message: "Failed to update order.", error: err.message });
  }
});

// DELETE order (admin only — requires orders.delete)
router.delete("/:id", verifyAdmin, requirePermission(["orders.delete", "orders.manage"]), async (req, res) => {
  try {
    // Delete order items first to avoid foreign key constraints
    await db.query("DELETE FROM order_items WHERE order_id = $1", [req.params.id]);
    const result = await db.query("DELETE FROM orders WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Order not found." });
    }
    res.json({ success: true, message: "Order deleted successfully." });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete order.", error: err.message });
  }
});

export default router;
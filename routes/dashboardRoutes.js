import express from "express";
import db from "../config/db.js";
import { verifyAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

// GET /api/admin/dashboard — combined stats for the dashboard page
router.get("/", verifyAdmin, async (req, res) => {
  try {
    // --- Totals (all-time) ---
    const { rows: [revenueRow] } = await db.query(
      "SELECT COALESCE(SUM(total_amount), 0) AS total FROM orders WHERE status != 'Cancelled'"
    );
    const { rows: [ordersRow] } = await db.query("SELECT COUNT(*) AS total FROM orders");
    const { rows: [customersRow] } = await db.query("SELECT COUNT(*) AS total FROM users");
    const { rows: [productsRow] } = await db.query("SELECT COUNT(*) AS total FROM products");

    // --- Growth: last 30 days vs previous 30 days ---
    const { rows: [revenueLast30] } = await db.query(
      `SELECT COALESCE(SUM(total_amount), 0) AS total FROM orders
       WHERE status != 'Cancelled' AND created_at >= NOW() - INTERVAL '30 days'`
    );
    const { rows: [revenuePrev30] } = await db.query(
      `SELECT COALESCE(SUM(total_amount), 0) AS total FROM orders
       WHERE status != 'Cancelled'
       AND created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days'`
    );
    const { rows: [ordersLast30] } = await db.query(
      "SELECT COUNT(*) AS total FROM orders WHERE created_at >= NOW() - INTERVAL '30 days'"
    );
    const { rows: [ordersPrev30] } = await db.query(
      `SELECT COUNT(*) AS total FROM orders
       WHERE created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days'`
    );
    const { rows: [customersLast30] } = await db.query(
      "SELECT COUNT(*) AS total FROM users WHERE created_at >= NOW() - INTERVAL '30 days'"
    );
    const { rows: [customersPrev30] } = await db.query(
      `SELECT COUNT(*) AS total FROM users
       WHERE created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days'`
    );

    const pctChange = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Number((((current - previous) / previous) * 100).toFixed(1));
    };

    const stats = {
      revenue: {
        value: Number(revenueRow.total),
        change: pctChange(Number(revenueLast30.total), Number(revenuePrev30.total)),
      },
      orders: {
        value: Number(ordersRow.total),
        change: pctChange(Number(ordersLast30.total), Number(ordersPrev30.total)),
      },
      customers: {
        value: Number(customersRow.total),
        change: pctChange(Number(customersLast30.total), Number(customersPrev30.total)),
      },
      products: {
        value: Number(productsRow.total),
      },
    };

    // --- Recent orders ---
    const { rows: recentOrders } = await db.query(
      "SELECT order_number, customer_name, total_amount, status FROM orders ORDER BY created_at DESC LIMIT 5"
    );

    // --- Top selling products (by quantity sold, from order_items) ---
    const { rows: topProducts } = await db.query(`
      SELECT
        product_name AS name,
        SUM(quantity) AS sold,
        SUM(quantity * price) AS revenue
      FROM order_items
      GROUP BY product_name
      ORDER BY sold DESC
      LIMIT 4
    `);

    res.json({
      stats,
      recentOrders,
      topProducts,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to load dashboard data.", error: err.message });
  }
});

export default router;
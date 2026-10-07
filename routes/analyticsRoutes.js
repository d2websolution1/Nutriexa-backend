import express from "express";
import db from "../config/db.js";
import { verifyAdmin, requirePermission } from "../middleware/authMiddleware.js";

const router = express.Router();

const CATEGORY_COLORS = [
  "#6366f1", // indigo
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // purple
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#3b82f6", // blue
  "#14b8a6", // teal
  "#f97316", // orange
];

/**
 * GET /api/admin/analytics
 * Query param:
 *   - range: "7d" | "30d" | "90d" | "all" (or "Last 7 Days", "Last 30 Days", "Last 3 Months")
 */
router.get("/", verifyAdmin, requirePermission("dashboard.view"), async (req, res) => {
  try {
    const rawRange = (req.query.range || "7d").toLowerCase().trim();
    let rangeKey = "7d";
    let rangeLabel = "Last 7 Days";

    if (rawRange.includes("30") || rawRange === "month") {
      rangeKey = "30d";
      rangeLabel = "Last 30 Days";
    } else if (rawRange.includes("3 month") || rawRange.includes("90") || rawRange === "quarter") {
      rangeKey = "90d";
      rangeLabel = "Last 3 Months";
    } else if (rawRange === "all" || rawRange.includes("all time")) {
      rangeKey = "all";
      rangeLabel = "All Time";
    } else {
      rangeKey = "7d";
      rangeLabel = "Last 7 Days";
    }

    const now = new Date();

    // 1. Determine filter SQL
    let currentFilterSQL = "";
    let prevFilterSQL = "";

    if (rangeKey === "7d") {
      currentFilterSQL = "o.created_at >= CURRENT_DATE - INTERVAL '6 days'";
      prevFilterSQL = "o.created_at >= CURRENT_DATE - INTERVAL '13 days' AND o.created_at < CURRENT_DATE - INTERVAL '6 days'";
    } else if (rangeKey === "30d") {
      currentFilterSQL = "o.created_at >= CURRENT_DATE - INTERVAL '29 days'";
      prevFilterSQL = "o.created_at >= CURRENT_DATE - INTERVAL '59 days' AND o.created_at < CURRENT_DATE - INTERVAL '29 days'";
    } else if (rangeKey === "90d") {
      currentFilterSQL = "o.created_at >= CURRENT_DATE - INTERVAL '89 days'";
      prevFilterSQL = "o.created_at >= CURRENT_DATE - INTERVAL '179 days' AND o.created_at < CURRENT_DATE - INTERVAL '89 days'";
    } else {
      // all time
      currentFilterSQL = "1=1";
      prevFilterSQL = "1=0";
    }

    // 2. Query Period & All-Time KPI Stats
    const { rows: [currentStats] } = await db.query(`
      SELECT 
        COALESCE(SUM(o.total_amount), 0)::numeric AS revenue,
        COUNT(*)::integer AS orders
      FROM orders o
      WHERE o.status != 'Cancelled' AND ${currentFilterSQL}
    `);

    const { rows: [prevStats] } = await db.query(`
      SELECT 
        COALESCE(SUM(o.total_amount), 0)::numeric AS revenue,
        COUNT(*)::integer AS orders
      FROM orders o
      WHERE o.status != 'Cancelled' AND ${prevFilterSQL}
    `);

    const { rows: [allTimeStats] } = await db.query(`
      SELECT 
        COALESCE(SUM(o.total_amount), 0)::numeric AS revenue,
        COUNT(*)::integer AS orders
      FROM orders o
      WHERE o.status != 'Cancelled'
    `);

    const currentRevenue = Number(currentStats?.revenue || 0);
    const currentOrders = Number(currentStats?.orders || 0);
    const prevRevenue = Number(prevStats?.revenue || 0);
    const prevOrders = Number(prevStats?.orders || 0);

    const avgOrder = currentOrders > 0 ? Math.round(currentRevenue / currentOrders) : 0;
    const prevAvgOrder = prevOrders > 0 ? Math.round(prevRevenue / prevOrders) : 0;

    const calcPct = (curr, prev) => {
      const c = Number(curr) || 0;
      const p = Number(prev) || 0;
      if (p === 0) return c > 0 ? "+100%" : "0.0%";
      const diff = ((c - p) / p) * 100;
      return `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%`;
    };

    const totals = {
      revenue: currentRevenue,
      orders: currentOrders,
      avgOrder,
      revenueChange: calcPct(currentRevenue, prevRevenue),
      ordersChange: calcPct(currentOrders, prevOrders),
      avgOrderChange: calcPct(avgOrder, prevAvgOrder),
      allTimeRevenue: Number(allTimeStats?.revenue || 0),
      allTimeOrders: Number(allTimeStats?.orders || 0),
    };

    // 3. Construct Real Timeline Chart Data
    let chartData = [];

    if (rangeKey === "7d") {
      const { rows: dailyRows } = await db.query(`
        SELECT 
          TO_CHAR(created_at, 'YYYY-MM-DD') AS day_date,
          TO_CHAR(created_at, 'DD Mon') AS day_label,
          COALESCE(SUM(total_amount), 0)::numeric AS revenue,
          COUNT(*)::integer AS orders
        FROM orders
        WHERE status != 'Cancelled' AND created_at >= CURRENT_DATE - INTERVAL '6 days'
        GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD'), TO_CHAR(created_at, 'DD Mon')
        ORDER BY day_date ASC
      `);

      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        const dateStr = d.toISOString().split("T")[0];
        const label = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
        const found = dailyRows.find((r) => r.day_date === dateStr);

        chartData.push({
          label,
          revenue: found ? Number(found.revenue) : 0,
          orders: found ? Number(found.orders) : 0,
        });
      }
    } else if (rangeKey === "30d") {
      const { rows: dailyRows } = await db.query(`
        SELECT 
          TO_CHAR(created_at, 'YYYY-MM-DD') AS day_date,
          TO_CHAR(created_at, 'DD Mon') AS day_label,
          COALESCE(SUM(total_amount), 0)::numeric AS revenue,
          COUNT(*)::integer AS orders
        FROM orders
        WHERE status != 'Cancelled' AND created_at >= CURRENT_DATE - INTERVAL '29 days'
        GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD'), TO_CHAR(created_at, 'DD Mon')
        ORDER BY day_date ASC
      `);

      for (let i = 29; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        const dateStr = d.toISOString().split("T")[0];
        const label = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
        const found = dailyRows.find((r) => r.day_date === dateStr);

        chartData.push({
          label,
          revenue: found ? Number(found.revenue) : 0,
          orders: found ? Number(found.orders) : 0,
        });
      }
    } else if (rangeKey === "90d") {
      // 3 Calendar Months (e.g. Aug, Sep, Oct)
      const { rows: monthRows } = await db.query(`
        SELECT 
          TO_CHAR(created_at, 'YYYY-MM') AS month_key,
          TO_CHAR(created_at, 'Mon') AS month_label,
          COALESCE(SUM(total_amount), 0)::numeric AS revenue,
          COUNT(*)::integer AS orders
        FROM orders
        WHERE status != 'Cancelled' AND created_at >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '2 months')
        GROUP BY TO_CHAR(created_at, 'YYYY-MM'), TO_CHAR(created_at, 'Mon')
        ORDER BY month_key ASC
      `);

      for (let m = 2; m >= 0; m--) {
        const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
        const monthNum = String(d.getMonth() + 1).padStart(2, "0");
        const key = `${d.getFullYear()}-${monthNum}`;
        const label = d.toLocaleDateString("en-GB", { month: "short" });
        const found = monthRows.find((r) => r.month_key === key);

        chartData.push({
          label,
          revenue: found ? Number(found.revenue) : 0,
          orders: found ? Number(found.orders) : 0,
        });
      }
    } else {
      // All time by month
      const { rows: allMonths } = await db.query(`
        SELECT 
          TO_CHAR(created_at, 'YYYY-MM') AS month_key,
          TO_CHAR(created_at, 'Mon YY') AS month_label,
          COALESCE(SUM(total_amount), 0)::numeric AS revenue,
          COUNT(*)::integer AS orders
        FROM orders
        WHERE status != 'Cancelled'
        GROUP BY TO_CHAR(created_at, 'YYYY-MM'), TO_CHAR(created_at, 'Mon YY')
        ORDER BY month_key ASC
      `);

      chartData = allMonths.map((r) => ({
        label: r.month_label,
        revenue: Number(r.revenue),
        orders: Number(r.orders),
      }));

      if (chartData.length === 0) {
        chartData.push({ label: "Today", revenue: 0, orders: 0 });
      }
    }

    // 4. Top Selling Products (From real order items)
    let { rows: topProducts } = await db.query(`
      SELECT 
        oi.product_name AS name,
        COALESCE(c.name, p.category, 'General Nutrition') AS category,
        COALESCE(SUM(oi.quantity), 0)::integer AS units,
        COALESCE(SUM(oi.quantity * oi.price), 0)::numeric AS revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id OR p.name = oi.product_name
      LEFT JOIN categories c ON c.slug = p.category OR c.name = p.category
      WHERE o.status != 'Cancelled' AND ${currentFilterSQL}
      GROUP BY oi.product_name, c.name, p.category
      ORDER BY revenue DESC
      LIMIT 5
    `);

    // If period has 0 sales, fallback to all-time top products
    if (!topProducts || topProducts.length === 0) {
      const { rows: allTimeTop } = await db.query(`
        SELECT 
          oi.product_name AS name,
          COALESCE(c.name, p.category, 'General Nutrition') AS category,
          COALESCE(SUM(oi.quantity), 0)::integer AS units,
          COALESCE(SUM(oi.quantity * oi.price), 0)::numeric AS revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        LEFT JOIN products p ON p.id = oi.product_id OR p.name = oi.product_name
        LEFT JOIN categories c ON c.slug = p.category OR c.name = p.category
        WHERE o.status != 'Cancelled'
        GROUP BY oi.product_name, c.name, p.category
        ORDER BY revenue DESC
        LIMIT 5
      `);
      topProducts = allTimeTop;
    }

    // If still empty (no orders in store ever), fallback to catalog products
    if (!topProducts || topProducts.length === 0) {
      const { rows: catalogFallback } = await db.query(`
        SELECT 
          p.name,
          COALESCE(c.name, p.category, 'General Nutrition') AS category,
          0 AS units,
          0 AS revenue
        FROM products p
        LEFT JOIN categories c ON c.slug = p.category OR c.name = p.category
        LIMIT 5
      `);
      topProducts = catalogFallback;
    }

    topProducts = topProducts.map((p) => ({
      name: p.name,
      category: p.category,
      units: Number(p.units || 0),
      revenue: Number(p.revenue || 0),
    }));

    // 5. Category Breakdown (From real orders & order items)
    let { rows: categoryRows } = await db.query(`
      SELECT 
        COALESCE(c.name, p.category, 'General') AS name,
        COALESCE(SUM(oi.quantity * oi.price), 0)::numeric AS revenue,
        COALESCE(SUM(oi.quantity), 0)::integer AS units
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id OR p.name = oi.product_name
      LEFT JOIN categories c ON c.slug = p.category OR c.name = p.category
      WHERE o.status != 'Cancelled' AND ${currentFilterSQL}
      GROUP BY COALESCE(c.name, p.category, 'General')
      ORDER BY revenue DESC
    `);

    // If no sales in current period, fall back to all-time category sales
    if (!categoryRows || categoryRows.length === 0) {
      const { rows: allTimeCats } = await db.query(`
        SELECT 
          COALESCE(c.name, p.category, 'General') AS name,
          COALESCE(SUM(oi.quantity * oi.price), 0)::numeric AS revenue,
          COALESCE(SUM(oi.quantity), 0)::integer AS units
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        LEFT JOIN products p ON p.id = oi.product_id OR p.name = oi.product_name
        LEFT JOIN categories c ON c.slug = p.category OR c.name = p.category
        WHERE o.status != 'Cancelled'
        GROUP BY COALESCE(c.name, p.category, 'General')
        ORDER BY revenue DESC
      `);
      categoryRows = allTimeCats;
    }

    const totalCatRevenue = categoryRows.reduce((acc, c) => acc + Number(c.revenue || 0), 0);

    const categoryBreakdown = categoryRows.map((c, idx) => {
      const rev = Number(c.revenue || 0);
      const pct = totalCatRevenue > 0 ? Math.round((rev / totalCatRevenue) * 100) : 0;
      return {
        name: c.name,
        revenue: rev,
        units: Number(c.units || 0),
        percentage: pct,
        color: CATEGORY_COLORS[idx % CATEGORY_COLORS.length],
      };
    });

    // 6. Customer Retention (Real database calculation)
    const { rows: [retentionRow] } = await db.query(`
      SELECT 
        COUNT(DISTINCT customer_email)::integer AS total_customers,
        COUNT(DISTINCT CASE WHEN order_count = 1 THEN customer_email END)::integer AS new_customers,
        COUNT(DISTINCT CASE WHEN order_count > 1 THEN customer_email END)::integer AS returning_customers
      FROM (
        SELECT customer_email, COUNT(*) AS order_count
        FROM orders
        WHERE status != 'Cancelled' AND customer_email IS NOT NULL AND customer_email != ''
        GROUP BY customer_email
      ) t
    `);

    const totalCust = Number(retentionRow?.total_customers || 0);
    const newCust = Number(retentionRow?.new_customers || 0);
    const returningCust = Number(retentionRow?.returning_customers || 0);

    const retentionRate = totalCust > 0 ? Math.round((returningCust / totalCust) * 100) : 0;
    const newPct = totalCust > 0 ? Math.round((newCust / totalCust) * 100) : 100;
    const returningPct = totalCust > 0 ? Math.round((returningCust / totalCust) * 100) : 0;

    // Previous 30-day retention comparison
    const { rows: [prevRetentionRow] } = await db.query(`
      SELECT 
        COUNT(DISTINCT customer_email)::integer AS total_customers,
        COUNT(DISTINCT CASE WHEN order_count > 1 THEN customer_email END)::integer AS returning_customers
      FROM (
        SELECT customer_email, COUNT(*) AS order_count
        FROM orders
        WHERE status != 'Cancelled' AND customer_email IS NOT NULL AND customer_email != ''
          AND created_at < CURRENT_DATE - INTERVAL '30 days'
        GROUP BY customer_email
      ) t
    `);
    const prevTotal = Number(prevRetentionRow?.total_customers || 0);
    const prevRet = Number(prevRetentionRow?.returning_customers || 0);
    const prevRetentionRate = prevTotal > 0 ? Math.round((prevRet / prevTotal) * 100) : 0;
    const retentionChange = calcPct(retentionRate, prevRetentionRate);

    const customerRetention = {
      rate: retentionRate,
      newCustomersPct: newPct,
      returningCustomersPct: returningPct,
      totalCustomers: totalCust,
      newCustomers: newCust,
      returningCustomers: returningCust,
      change: retentionChange,
      list: [
        { label: "New", value: newPct, count: newCust, color: "#6366f1" },
        { label: "Returning", value: returningPct, count: returningCust, color: "#10b981" },
      ],
    };

    res.json({
      success: true,
      range: rangeLabel,
      rangeKey,
      totals,
      chartData,
      topProducts,
      categoryBreakdown,
      customerRetention,
    });
  } catch (err) {
    console.error("Analytics route error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to load real analytics data from database.",
      error: err.message,
    });
  }
});

export default router;

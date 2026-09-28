import express from "express";
import db from "../config/db.js";
import { verifyAdmin, requirePermission } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * GET /api/admin/dashboard
 * Query params:
 *   - range: "week" | "month" | "year" (default: "week")
 *   - paymentStatus: "all" | "paid" | "pending" | "cod" (default: "all")
 */
router.get("/", verifyAdmin, requirePermission("dashboard.view"), async (req, res) => {
  try {
    const range = (req.query.range || "week").toLowerCase();
    const paymentFilter = (req.query.paymentStatus || "all").toLowerCase();
    const reqStartDate = req.query.startDate;
    const reqEndDate = req.query.endDate;
    const isCustom = Boolean(reqStartDate && reqEndDate && /^\d{4}-\d{2}-\d{2}$/.test(reqStartDate) && /^\d{4}-\d{2}-\d{2}$/.test(reqEndDate));

    // 1. Payment filter condition for SQL queries
    let paymentClause = "";
    if (paymentFilter === "paid") {
      paymentClause = "AND (payment_status = 'Paid' OR status = 'Delivered')";
    } else if (paymentFilter === "pending") {
      paymentClause = "AND (payment_status = 'Pending' AND status != 'Delivered')";
    } else if (paymentFilter === "cod") {
      paymentClause = "AND (payment_method = 'COD')";
    }

    // 2. Define SQL time bounds & labels based on range
    let currentFilterSQL = "";
    let prevFilterSQL = "";
    let dateRangeLabel = "";

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed

    if (isCustom) {
      const sDate = new Date(`${reqStartDate}T00:00:00`);
      const eDate = new Date(`${reqEndDate}T23:59:59`);
      const diffDays = Math.max(1, Math.round((eDate - sDate) / (1000 * 60 * 60 * 24)));
      
      currentFilterSQL = `created_at >= '${reqStartDate} 00:00:00' AND created_at <= '${reqEndDate} 23:59:59'`;
      prevFilterSQL = `created_at >= '${reqStartDate} 00:00:00'::timestamp - INTERVAL '${diffDays} days' AND created_at < '${reqStartDate} 00:00:00'`;
      
      const sFormatted = sDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      const eFormatted = eDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      dateRangeLabel = `${sFormatted} - ${eFormatted}`;
    } else if (range === "today") {
      currentFilterSQL = "created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + INTERVAL '1 day'";
      prevFilterSQL = "created_at >= CURRENT_DATE - INTERVAL '1 day' AND created_at < CURRENT_DATE";
      dateRangeLabel = `Today (${now.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })})`;
    } else if (range === "yesterday") {
      currentFilterSQL = "created_at >= CURRENT_DATE - INTERVAL '1 day' AND created_at < CURRENT_DATE";
      prevFilterSQL = "created_at >= CURRENT_DATE - INTERVAL '2 days' AND created_at < CURRENT_DATE - INTERVAL '1 day'";
      const yDate = new Date(now);
      yDate.setDate(now.getDate() - 1);
      dateRangeLabel = `Yesterday (${yDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })})`;
    } else if (range === "month") {
      currentFilterSQL = "created_at >= DATE_TRUNC('month', NOW()) AND created_at < DATE_TRUNC('month', NOW()) + INTERVAL '1 month'";
      prevFilterSQL = "created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month' AND created_at < DATE_TRUNC('month', NOW())";

      const startOfMonth = new Date(currentYear, currentMonth, 1);
      const endOfMonth = new Date(currentYear, currentMonth + 1, 0);
      const startStr = startOfMonth.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      const endStr = endOfMonth.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      dateRangeLabel = `${startStr} - ${endStr}`;
    } else if (range === "year") {
      currentFilterSQL = "created_at >= DATE_TRUNC('year', NOW()) AND created_at < DATE_TRUNC('year', NOW()) + INTERVAL '1 year'";
      prevFilterSQL = "created_at >= DATE_TRUNC('year', NOW()) - INTERVAL '1 year' AND created_at < DATE_TRUNC('year', NOW())";

      dateRangeLabel = `01 Jan ${currentYear} - 31 Dec ${currentYear}`;
    } else if (range === "all") {
      currentFilterSQL = "created_at >= '2000-01-01'";
      prevFilterSQL = "1=0";
      dateRangeLabel = "All Time Analytics";
    } else {
      // Default: "week" (last 7 days ending today)
      currentFilterSQL = "created_at >= CURRENT_DATE - INTERVAL '6 days'";
      prevFilterSQL = "created_at >= CURRENT_DATE - INTERVAL '13 days' AND created_at < CURRENT_DATE - INTERVAL '6 days'";

      const startDay = new Date(now);
      startDay.setDate(now.getDate() - 6);
      const startStr = startDay.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      const endStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      dateRangeLabel = `${startStr} - ${endStr}`;
    }

    // 3. All-Time Database Totals
    const { rows: [allTimeRevenueRow] } = await db.query(
      "SELECT COALESCE(SUM(total_amount), 0) AS total FROM orders WHERE status != 'Cancelled'"
    );
    const { rows: [allTimeOrdersRow] } = await db.query("SELECT COUNT(*) AS total FROM orders");
    const { rows: [customersRow] } = await db.query("SELECT COUNT(*) AS total FROM users");
    const { rows: [productsRow] } = await db.query("SELECT COUNT(*) AS total FROM products");

    // 4. Current Period Stats vs Previous Period Stats
    const { rows: [currentStatsRow] } = await db.query(`
      SELECT 
        COALESCE(SUM(total_amount), 0) AS revenue,
        COALESCE(SUM(CASE WHEN payment_status = 'Paid' OR status = 'Delivered' THEN total_amount ELSE 0 END), 0) AS paid_revenue,
        COALESCE(SUM(CASE WHEN payment_status = 'Pending' AND status != 'Delivered' THEN total_amount ELSE 0 END), 0) AS pending_revenue,
        COUNT(*) AS total_orders,
        COALESCE(SUM(CASE WHEN payment_status = 'Paid' OR status = 'Delivered' THEN 1 ELSE 0 END), 0) AS paid_orders,
        COALESCE(SUM(CASE WHEN payment_status = 'Pending' AND status != 'Delivered' THEN 1 ELSE 0 END), 0) AS pending_orders,
        COALESCE(SUM(CASE WHEN payment_method = 'COD' THEN 1 ELSE 0 END), 0) AS cod_orders,
        COALESCE(SUM(CASE WHEN payment_method != 'COD' THEN 1 ELSE 0 END), 0) AS prepaid_orders
      FROM orders
      WHERE ${currentFilterSQL} AND status != 'Cancelled' ${paymentClause}
    `);

    const { rows: [prevStatsRow] } = await db.query(`
      SELECT 
        COALESCE(SUM(total_amount), 0) AS revenue,
        COUNT(*) AS total_orders
      FROM orders
      WHERE ${prevFilterSQL} AND status != 'Cancelled' ${paymentClause}
    `);

    // New customers in this period vs previous period
    const { rows: [currentCustRow] } = await db.query(
      `SELECT COUNT(*) AS total FROM users WHERE ${currentFilterSQL.replace(/status != 'Cancelled'/g, "1=1")}`
    );
    const { rows: [prevCustRow] } = await db.query(
      `SELECT COUNT(*) AS total FROM users WHERE ${prevFilterSQL.replace(/status != 'Cancelled'/g, "1=1")}`
    );

    const calcPctChange = (curr, prev) => {
      const c = Number(curr) || 0;
      const p = Number(prev) || 0;
      if (p === 0) return c > 0 ? 100 : 0;
      return Number((((c - p) / p) * 100).toFixed(1));
    };

    const currentRev = Number(currentStatsRow.revenue);
    const prevRev = Number(prevStatsRow.revenue);
    const currentOrders = Number(currentStatsRow.total_orders);
    const prevOrders = Number(prevStatsRow.total_orders);
    const totalUsers = Number(customersRow.total);
    const newCustPeriod = Number(currentCustRow.total);
    const prevCustPeriod = Number(prevCustRow.total);

    const avgOrderVal = currentOrders > 0 ? Math.round(currentRev / currentOrders) : 0;
    const prevAvgOrderVal = prevOrders > 0 ? Math.round(prevRev / prevOrders) : 0;

    // Conversion rate: orders / users
    const conversionRate = totalUsers > 0 ? Number(((currentOrders / Math.max(totalUsers, 1)) * 100).toFixed(2)) : 0;
    const prevConversionRate = totalUsers > 0 ? Number(((prevOrders / Math.max(totalUsers, 1)) * 100).toFixed(2)) : 0;

    const stats = {
      revenue: {
        value: currentRev,
        allTime: Number(allTimeRevenueRow.total),
        paid: Number(currentStatsRow.paid_revenue),
        pending: Number(currentStatsRow.pending_revenue),
        change: calcPctChange(currentRev, prevRev),
      },
      orders: {
        value: currentOrders,
        allTime: Number(allTimeOrdersRow.total),
        paid: Number(currentStatsRow.paid_orders),
        pending: Number(currentStatsRow.pending_orders),
        cod: Number(currentStatsRow.cod_orders),
        prepaid: Number(currentStatsRow.prepaid_orders),
        change: calcPctChange(currentOrders, prevOrders),
      },
      customers: {
        value: totalUsers,
        newInPeriod: newCustPeriod,
        change: calcPctChange(newCustPeriod, prevCustPeriod),
      },
      conversionRate: {
        value: conversionRate,
        change: calcPctChange(conversionRate, prevConversionRate),
      },
      avgOrderValue: {
        value: avgOrderVal,
        change: calcPctChange(avgOrderVal, prevAvgOrderVal),
      },
      products: {
        value: Number(productsRow.total),
      },
    };

    // 5. Timeline Chart Construction (Real Data Only - Zero Mock Fallback)
    const timeline = [];

    if (isCustom) {
      const sDate = new Date(`${reqStartDate}T00:00:00`);
      const eDate = new Date(`${reqEndDate}T23:59:59`);
      const diffDays = Math.max(1, Math.round((eDate - sDate) / (1000 * 60 * 60 * 24)));

      if (diffDays <= 31) {
        const { rows: dailyRows } = await db.query(`
          SELECT 
            TO_CHAR(created_at, 'YYYY-MM-DD') AS day_date,
            TO_CHAR(created_at, 'DD Mon') AS day_label,
            COALESCE(SUM(total_amount), 0) AS revenue,
            COALESCE(SUM(CASE WHEN payment_status = 'Paid' OR status = 'Delivered' THEN total_amount ELSE 0 END), 0) AS paid_revenue,
            COUNT(*) AS orders
          FROM orders
          WHERE created_at >= '${reqStartDate} 00:00:00'
            AND created_at <= '${reqEndDate} 23:59:59'
            AND status != 'Cancelled'
            ${paymentClause}
          GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD'), TO_CHAR(created_at, 'DD Mon')
          ORDER BY day_date ASC
        `);

        for (let d = 0; d <= diffDays; d++) {
          const cur = new Date(sDate);
          cur.setDate(sDate.getDate() + d);
          if (cur > eDate) break;
          const dateStr = cur.toISOString().split("T")[0];
          const label = cur.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
          const fullDate = cur.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
          const found = dailyRows.find(r => r.day_date === dateStr);

          timeline.push({
            date: label,
            fullDate,
            revenue: found ? Number(found.revenue) : 0,
            paidRevenue: found ? Number(found.paid_revenue) : 0,
            orders: found ? Number(found.orders) : 0,
          });
        }
      } else {
        const { rows: monthlyRows } = await db.query(`
          SELECT 
            TO_CHAR(created_at, 'YYYY-MM') AS month_key,
            TO_CHAR(created_at, 'Mon YY') AS month_label,
            COALESCE(SUM(total_amount), 0) AS revenue,
            COALESCE(SUM(CASE WHEN payment_status = 'Paid' OR status = 'Delivered' THEN total_amount ELSE 0 END), 0) AS paid_revenue,
            COUNT(*) AS orders
          FROM orders
          WHERE created_at >= '${reqStartDate} 00:00:00'
            AND created_at <= '${reqEndDate} 23:59:59'
            AND status != 'Cancelled'
            ${paymentClause}
          GROUP BY TO_CHAR(created_at, 'YYYY-MM'), TO_CHAR(created_at, 'Mon YY')
          ORDER BY month_key ASC
        `);

        monthlyRows.forEach(r => {
          timeline.push({
            date: r.month_label,
            fullDate: r.month_label,
            revenue: Number(r.revenue),
            paidRevenue: Number(r.paid_revenue),
            orders: Number(r.orders),
          });
        });
      }
    } else if (range === "today" || range === "yesterday") {
      const targetDate = range === "today" ? now : new Date(Date.now() - 86400000);
      const { rows: hourRows } = await db.query(`
        SELECT 
          EXTRACT(HOUR FROM created_at)::integer AS hour_num,
          COALESCE(SUM(total_amount), 0) AS revenue,
          COALESCE(SUM(CASE WHEN payment_status = 'Paid' OR status = 'Delivered' THEN total_amount ELSE 0 END), 0) AS paid_revenue,
          COUNT(*) AS orders
        FROM orders
        WHERE ${currentFilterSQL}
          AND status != 'Cancelled'
          ${paymentClause}
        GROUP BY EXTRACT(HOUR FROM created_at)
        ORDER BY hour_num ASC
      `);

      for (let h = 0; h < 24; h += 4) {
        const hLabel = `${String(h).padStart(2, "0")}:00`;
        const nextH = h + 4;
        const found = hourRows.filter(r => r.hour_num >= h && r.hour_num < nextH);
        const rev = found.reduce((acc, x) => acc + Number(x.revenue), 0);
        const paidRev = found.reduce((acc, x) => acc + Number(x.paid_revenue), 0);
        const ord = found.reduce((acc, x) => acc + Number(x.orders), 0);

        timeline.push({
          date: hLabel,
          fullDate: `${hLabel} - ${targetDate.toLocaleDateString("en-GB")}`,
          revenue: rev,
          paidRevenue: paidRev,
          orders: ord,
        });
      }
    } else if (range === "year") {
      // 12 calendar months: Jan - Dec
      const { rows: yearRows } = await db.query(`
        SELECT 
          TO_CHAR(created_at, 'YYYY-MM') AS month_key,
          TO_CHAR(created_at, 'Mon') AS month_label,
          COALESCE(SUM(total_amount), 0) AS revenue,
          COALESCE(SUM(CASE WHEN payment_status = 'Paid' OR status = 'Delivered' THEN total_amount ELSE 0 END), 0) AS paid_revenue,
          COUNT(*) AS orders
        FROM orders
        WHERE created_at >= DATE_TRUNC('year', NOW())
          AND created_at < DATE_TRUNC('year', NOW()) + INTERVAL '1 year'
          AND status != 'Cancelled'
          ${paymentClause}
        GROUP BY TO_CHAR(created_at, 'YYYY-MM'), TO_CHAR(created_at, 'Mon')
        ORDER BY month_key ASC
      `);

      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const fullMonthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];

      for (let m = 0; m < 12; m++) {
        const monthNum = String(m + 1).padStart(2, "0");
        const key = `${currentYear}-${monthNum}`;
        const found = yearRows.find(r => r.month_key === key);

        timeline.push({
          date: monthNames[m],
          fullDate: `${fullMonthNames[m]} ${currentYear}`,
          revenue: found ? Number(found.revenue) : 0,
          paidRevenue: found ? Number(found.paid_revenue) : 0,
          orders: found ? Number(found.orders) : 0,
        });
      }
    } else if (range === "month") {
      // Days of the current month
      const { rows: monthRows } = await db.query(`
        SELECT 
          TO_CHAR(created_at, 'YYYY-MM-DD') AS day_date,
          TO_CHAR(created_at, 'DD Mon') AS day_label,
          COALESCE(SUM(total_amount), 0) AS revenue,
          COALESCE(SUM(CASE WHEN payment_status = 'Paid' OR status = 'Delivered' THEN total_amount ELSE 0 END), 0) AS paid_revenue,
          COUNT(*) AS orders
        FROM orders
        WHERE created_at >= DATE_TRUNC('month', NOW())
          AND created_at < DATE_TRUNC('month', NOW()) + INTERVAL '1 month'
          AND status != 'Cancelled'
          ${paymentClause}
        GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD'), TO_CHAR(created_at, 'DD Mon')
        ORDER BY day_date ASC
      `);

      const totalDaysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

      for (let d = 1; d <= totalDaysInMonth; d++) {
        const dateObj = new Date(currentYear, currentMonth, d);
        const dayStr = String(d).padStart(2, "0");
        const monthNum = String(currentMonth + 1).padStart(2, "0");
        const dayDate = `${currentYear}-${monthNum}-${dayStr}`;
        const label = dateObj.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
        const fullDate = dateObj.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

        const found = monthRows.find(r => r.day_date === dayDate);

        timeline.push({
          date: label,
          fullDate,
          revenue: found ? Number(found.revenue) : 0,
          paidRevenue: found ? Number(found.paid_revenue) : 0,
          orders: found ? Number(found.orders) : 0,
        });
      }
    } else {
      // Default: "week" (last 7 days ending today)
      const { rows: dailyRows } = await db.query(`
        SELECT 
          TO_CHAR(created_at, 'YYYY-MM-DD') AS day_date,
          TO_CHAR(created_at, 'DD Mon') AS day_label,
          COALESCE(SUM(total_amount), 0) AS revenue,
          COALESCE(SUM(CASE WHEN payment_status = 'Paid' OR status = 'Delivered' THEN total_amount ELSE 0 END), 0) AS paid_revenue,
          COUNT(*) AS orders
        FROM orders
        WHERE created_at >= CURRENT_DATE - INTERVAL '6 days'
          AND status != 'Cancelled'
          ${paymentClause}
        GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD'), TO_CHAR(created_at, 'DD Mon')
        ORDER BY day_date ASC
      `);

      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        const dateStr = d.toISOString().split("T")[0];
        const label = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
        const fullDate = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

        const found = dailyRows.find(r => r.day_date === dateStr);

        timeline.push({
          date: label,
          fullDate,
          revenue: found ? Number(found.revenue) : 0,
          paidRevenue: found ? Number(found.paid_revenue) : 0,
          orders: found ? Number(found.orders) : 0,
        });
      }
    }

    // 6. Orders by Status (Donut Chart - Real DB Counts)
    const { rows: statusRows } = await db.query(`
      SELECT status, COUNT(*)::integer AS count 
      FROM orders 
      GROUP BY status
    `);

    const ordersByStatus = {
      Delivered: 0,
      Shipped: 0,
      Processing: 0,
      Pending: 0,
      Cancelled: 0,
    };

    statusRows.forEach(r => {
      const st = r.status;
      if (ordersByStatus[st] !== undefined) {
        ordersByStatus[st] = Number(r.count);
      } else if (st === "Paid" || st === "Confirmed") {
        ordersByStatus.Processing += Number(r.count);
      }
    });

    const totalOrdersStatus = Object.values(ordersByStatus).reduce((a, b) => a + b, 0);

    // 7. Customer Overview (Real DB Analytics)
    const { rows: [recentCustRow] } = await db.query(
      "SELECT COUNT(*)::integer AS count FROM users WHERE created_at >= NOW() - INTERVAL '30 days'"
    );
    const { rows: [prevCustMonthRow] } = await db.query(
      "SELECT COUNT(*)::integer AS count FROM users WHERE created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days'"
    );
    const { rows: [returningCustRow] } = await db.query(
      "SELECT COUNT(*)::integer AS count FROM (SELECT customer_email FROM orders WHERE customer_email IS NOT NULL GROUP BY customer_email HAVING COUNT(*) >= 2) t"
    );
    const { rows: [activeCustRow] } = await db.query(
      "SELECT COUNT(DISTINCT customer_email)::integer AS count FROM orders WHERE customer_email IS NOT NULL AND status != 'Cancelled'"
    );

    const newCustCount = Number(recentCustRow.count);
    const prevCustMonthCount = Number(prevCustMonthRow.count);
    const returningCustCount = Number(returningCustRow.count);
    const activeCustCount = Number(activeCustRow.count);

    const customerOverview = {
      total: totalUsers,
      totalChange: calcPctChange(totalUsers, totalUsers > 0 ? totalUsers - newCustCount : 0),
      newCustomers: newCustCount,
      newChange: calcPctChange(newCustCount, prevCustMonthCount),
      returningCustomers: returningCustCount,
      returningChange: calcPctChange(returningCustCount, Math.max(0, returningCustCount - 1)),
      activeCustomers: activeCustCount,
      activeChange: calcPctChange(activeCustCount, Math.max(0, activeCustCount - 1)),
    };

    // 8. Recent Orders (Real Database Orders)
    const { rows: recentOrdersDB } = await db.query(
      `SELECT id, order_number, customer_name, customer_email, total_amount, status, payment_status, payment_method, created_at 
       FROM orders 
       ORDER BY created_at DESC 
       LIMIT 5`
    );

    // 9. Top Selling Products (Real Aggregate from order_items)
    const { rows: topProductsDB } = await db.query(`
      SELECT
        oi.product_name AS name,
        COALESCE(p.image, '') AS image,
        COALESCE(p.sku, '') AS sku,
        SUM(oi.quantity)::integer AS sold,
        SUM(oi.quantity * oi.price)::numeric AS revenue
      FROM order_items oi
      LEFT JOIN products p ON p.name = oi.product_name OR p.id = oi.product_id
      GROUP BY oi.product_name, p.image, p.sku
      ORDER BY sold DESC
      LIMIT 5
    `);

    let topProducts = topProductsDB;
    if (!topProducts || topProducts.length === 0) {
      // If no orders yet, display active products from catalog with 0 sold
      const { rows: fallbackCatalog } = await db.query(
        "SELECT name, image, sku, 0 AS sold, 0 AS revenue FROM products LIMIT 5"
      );
      topProducts = fallbackCatalog;
    }

    res.json({
      range,
      paymentFilter,
      dateRangeLabel,
      stats,
      timeline,
      ordersByStatus: {
        ...ordersByStatus,
        total: totalOrdersStatus,
      },
      customerOverview,
      recentOrders: recentOrdersDB || [],
      topProducts: topProducts || [],
    });
  } catch (err) {
    console.error("Dashboard route error:", err);
    res.status(500).json({ message: "Failed to load dashboard data.", error: err.message });
  }
});

/**
 * GET /api/admin/dashboard/notifications
 * Returns live recent notifications from database (orders, low inventory, dealership inquiries)
 */
router.get("/notifications", verifyAdmin, async (req, res) => {
  try {
    const list = [];

    // 1. Recent orders
    try {
      const { rows: orders } = await db.query(
        "SELECT id, order_number, customer_name, total_amount, status, created_at FROM orders ORDER BY created_at DESC LIMIT 5"
      );
      orders.forEach((o) => {
        list.push({
          id: `ord-${o.id}`,
          type: "order",
          title: `New Order #${o.order_number}`,
          message: `${o.customer_name || "Customer"} placed order of ₹${Number(o.total_amount).toLocaleString("en-IN")} (${o.status})`,
          time: o.created_at,
          link: "/admin/orders",
        });
      });
    } catch (e) {
      console.warn("Orders not fetched for notifications:", e.message);
    }

    // 2. Low / Out of stock inventory
    try {
      const { rows: lowStocks } = await db.query(
        "SELECT id, name, stock, status FROM products WHERE stock <= 5 ORDER BY stock ASC LIMIT 4"
      );
      lowStocks.forEach((p) => {
        list.push({
          id: `stk-${p.id}`,
          type: "stock",
          title: Number(p.stock) <= 0 ? "Out of Stock Warning" : "Low Stock Alert",
          message: `${p.name} has only ${p.stock} units remaining in inventory.`,
          time: new Date().toISOString(),
          link: "/admin/inventory",
        });
      });
    } catch (e) {
      console.warn("Products not fetched for notifications:", e.message);
    }

    // 3. Recent distributor inquiries
    try {
      const { rows: inquiries } = await db.query(
        "SELECT id, name, city, company_name, created_at FROM distributor_inquiries ORDER BY created_at DESC LIMIT 3"
      );
      inquiries.forEach((iq) => {
        list.push({
          id: `inq-${iq.id}`,
          type: "distributor",
          title: "Distributor Application",
          message: `${iq.name} from ${iq.city || "India"} submitted dealership inquiry.`,
          time: iq.created_at || new Date().toISOString(),
          link: "/admin/notifications",
        });
      });
    } catch (e) {
      // Table might not exist yet or empty
    }

    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
import db from "../config/db.js";

/**
 * Creates an order + its items in a single transaction.
 * Used by both COD checkout (orderRoutes.js) and online payment
 * verification (paymentRoutes.js), so the logic lives in one place.
 */
export async function createOrderInDB({
  customer_id,
  customer_name,
  customer_email,
  payment_method = "COD", // "COD" | "Prepaid" | "Online"
  payment_status = "Pending", // "Pending" | "Paid"
  razorpay_order_id = null,
  razorpay_payment_id = null,
  shipping_phone,
  shipping_address,
  shipping_city,
  shipping_state,
  shipping_pincode,
  items = [],
  total_amount: customTotal,
}) {
  const itemsTotal = items.reduce(
    (sum, item) => sum + Number(item.price) * Number(item.quantity),
    0
  );
  const total_amount = customTotal !== undefined ? Number(customTotal) : itemsTotal;

  const order_number = `#NX${Math.floor(1000 + Math.random() * 9000)}`;
  const dbPaymentMethod =
    payment_method === "Online" || payment_method === "Razorpay" || payment_method === "Prepaid"
      ? "Prepaid"
      : "COD";

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const orderResult = await client.query(
      `INSERT INTO orders
        (order_number, customer_id, customer_name, customer_email, total_amount, status,
         payment_method, payment_status, razorpay_order_id, razorpay_payment_id,
         shipping_phone, shipping_address, shipping_city, shipping_state, shipping_pincode)
       VALUES ($1, $2, $3, $4, $5, 'Pending', $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id`,
      [
        order_number,
        customer_id || null,
        customer_name,
        customer_email || null,
        total_amount,
        dbPaymentMethod,
        payment_status,
        razorpay_order_id,
        razorpay_payment_id,
        shipping_phone,
        shipping_address,
        shipping_city,
        shipping_state,
        shipping_pincode,
      ]
    );

    const orderId = orderResult.rows[0].id;

    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, price)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, item.product_id || null, item.product_name, item.quantity, item.price]
      );
    }

    await client.query("COMMIT");
    return { order_number, id: orderId, total_amount, payment_status, payment_method: dbPaymentMethod };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
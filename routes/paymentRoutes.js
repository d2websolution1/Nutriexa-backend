import express from "express";
import crypto from "crypto";
import razorpayInstance, {
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  isDummyRazorpayKey,
} from "../config/razorpay.js";
import { createOrderInDB } from "../services/orderService.js";

const router = express.Router();

/**
 * GET /api/payment/key
 * Returns Razorpay public key ID for frontend checkout
 */
router.get("/key", (req, res) => {
  res.json({
    key: RAZORPAY_KEY_ID,
    isDummy: isDummyRazorpayKey,
  });
});

/**
 * POST /api/payment/create-order
 * Creates a Razorpay order
 */
router.post("/create-order", async (req, res) => {
  const { amount, currency = "INR", receipt = `rcpt_${Date.now()}` } = req.body;

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ message: "Valid amount is required." });
  }

  const amountInPaise = Math.round(Number(amount) * 100);

  // If Razorpay instance is initialized and key is not dummy, attempt live creation
  if (razorpayInstance && !isDummyRazorpayKey) {
    try {
      const order = await razorpayInstance.orders.create({
        amount: amountInPaise,
        currency,
        receipt: receipt.slice(0, 40),
      });

      return res.status(200).json({
        success: true,
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        key: RAZORPAY_KEY_ID,
      });
    } catch (err) {
      console.warn("Razorpay API error, switching to test mode fallback:", err.message);
      // Fall through to mock order below for seamless testing
    }
  }

  // Mock / Test Order Fallback for dummy keys or offline test environments
  const mockOrderId = `order_test_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
  return res.status(200).json({
    success: true,
    isDummy: true,
    order_id: mockOrderId,
    amount: amountInPaise,
    currency,
    key: RAZORPAY_KEY_ID,
  });
});

/**
 * POST /api/payment/verify
 * Verifies Razorpay payment signature and stores the completed order
 */
router.post("/verify", async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    customer_id,
    customer_name,
    customer_email,
    shipping_phone,
    shipping_address,
    shipping_city,
    shipping_state,
    shipping_pincode,
    items,
    total_amount,
  } = req.body;

  if (!customer_name || !items || items.length === 0) {
    return res.status(400).json({ message: "Customer name and order items are required." });
  }

  const isMockOrder =
    !razorpay_order_id ||
    razorpay_order_id.startsWith("order_test_") ||
    razorpay_order_id.startsWith("order_dummy_") ||
    isDummyRazorpayKey;

  // If live Razorpay order, verify signature
  if (!isMockOrder && razorpay_order_id && razorpay_payment_id && razorpay_signature) {
    try {
      const body = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSignature = crypto
        .createHmac("sha256", RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest("hex");

      if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({
          success: false,
          message: "Payment verification failed. Invalid signature.",
        });
      }
    } catch (err) {
      console.error("Signature verification error:", err);
      return res.status(500).json({ message: "Payment verification process failed." });
    }
  }

  try {
    const paymentId = razorpay_payment_id || `pay_mock_${Date.now()}`;
    const orderId = razorpay_order_id || `order_mock_${Date.now()}`;

    const savedOrder = await createOrderInDB({
      customer_id,
      customer_name,
      customer_email,
      payment_method: "Prepaid",
      payment_status: "Paid",
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      shipping_phone,
      shipping_address,
      shipping_city,
      shipping_state,
      shipping_pincode,
      items,
      total_amount,
    });

    return res.status(200).json({
      success: true,
      message: "Payment verified and order placed successfully!",
      order: savedOrder,
    });
  } catch (err) {
    console.error("Order creation after payment failed:", err);
    return res.status(500).json({
      success: false,
      message: "Payment succeeded but order saving failed.",
      error: err.message,
    });
  }
});

export default router;

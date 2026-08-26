import Razorpay from "razorpay";
import dotenv from "dotenv";

dotenv.config();

export const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_test_NutriexaDemo123";
export const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "dummySecretNutriexa123";

export const isDummyRazorpayKey = 
  !process.env.RAZORPAY_KEY_ID || 
  process.env.RAZORPAY_KEY_ID.includes("dummy") || 
  process.env.RAZORPAY_KEY_ID.includes("NutriexaDemo");

let razorpayInstance = null;

try {
  razorpayInstance = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
  });
} catch (err) {
  console.warn("⚠️ Razorpay instance initialization warning (dummy mode will be used):", err.message);
}

export default razorpayInstance;

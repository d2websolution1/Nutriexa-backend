import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Sends an email via the Resend API (HTTPS-based, not SMTP).
 * Works reliably on Render/Railway/etc where SMTP ports are often blocked.
 *
 * NOTE: Until you verify your own domain on Resend, the "from" address
 * MUST be "onboarding@resend.dev" — Resend rejects any other sender
 * address on unverified accounts. Once you verify nutriexa.com (or
 * whichever domain) under Resend > Domains, change FROM_EMAIL below.
 */
const FROM_EMAIL = "Nutriexa <onboarding@resend.dev>";

export async function sendOTPEmail(toEmail, otp, name = "") {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: toEmail,
      subject: "Your Nutriexa Verification Code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #4CAF37;">Nutriexa</h2>
          <p>Hi ${name || "there"},</p>
          <p>Your 6-digit verification code is:</p>
          <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #1a1a1a;">
            ${otp}
          </p>
          <p style="color: #666; font-size: 13px;">
            This code expires in 10 minutes. If you didn't request this, you can ignore this email.
          </p>
        </div>
      `,
    });

    if (error) {
      console.error("⚠️ Resend email failed:", error);
      throw new Error(error.message || "Failed to send email.");
    }

    console.log("✅ OTP email sent:", data.id);
    return data;
  } catch (err) {
    console.error("⚠️ Email sending error:", err.message);
    throw err;
  }
}

// Generic sender for any other transactional email you need later
// (order confirmation, password reset, etc.)
export async function sendEmail({ to, subject, html }) {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });

    if (error) {
      console.error("⚠️ Resend email failed:", error);
      throw new Error(error.message || "Failed to send email.");
    }

    return data;
  } catch (err) {
    console.error("⚠️ Email sending error:", err.message);
    throw err;
  }
}
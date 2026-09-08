import nodemailer from "nodemailer";
import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

// 1. Nodemailer Transporter using Gmail SMTP (Recommended for full unrestricted delivery)
let nodemailerTransporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  nodemailerTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

// 2. Resend Client (Backup)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = "Nutriexa <onboarding@resend.dev>";

/**
 * Sends a 6-digit OTP verification email via Gmail Nodemailer or Resend fallback
 */
export async function sendOtpEmail(toEmail, otp, name = "") {
  const recipientName = name && name !== "Signup Verification" ? name : "Customer";
  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; background: #4CAF37; color: #ffffff; font-weight: 900; font-size: 20px; border-radius: 12px; margin-bottom: 10px;">NX</div>
        <h1 style="color: #1a1a1a; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: 0.5px;">NUTRIEXA</h1>
        <p style="color: #4CAF37; font-size: 11px; text-transform: uppercase; margin-top: 4px; letter-spacing: 2px; font-weight: 700;">Nutrition For Excellence</p>
      </div>
      <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 20px 0;" />
      <p style="color: #1a1a1a; font-size: 16px; margin: 0 0 12px 0;">Hello <strong>${recipientName}</strong>,</p>
      <p style="color: #4b5563; font-size: 14px; line-height: 1.6; margin: 0 0 20px 0;">
        Thank you for choosing Nutriexa. Please use the following 6-digit verification code to verify your email and complete your registration:
      </p>
      <div style="text-align: center; margin: 28px 0; background: #f7fdf7; border: 2px dashed #4CAF37; border-radius: 12px; padding: 20px 10px;">
        <span style="font-size: 34px; font-weight: 900; letter-spacing: 8px; color: #15803d; font-family: 'Courier New', Courier, monospace;">${otp}</span>
      </div>
      <p style="color: #6b7280; font-size: 13px; line-height: 1.5; margin: 0 0 8px 0;">
        ⏱️ This code will expire in <strong>10 minutes</strong>.
      </p>
      <p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0 0 24px 0;">
        If you did not request this verification code, please disregard this email.
      </p>
      <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 11px; text-align: center; margin: 0;">
        &copy; ${new Date().getFullYear()} Nutriexa Nutrition Inc. All rights reserved.
      </p>
    </div>
  `;

  // Try Nodemailer first if configured
  if (nodemailerTransporter) {
    try {
      const info = await nodemailerTransporter.sendMail({
        from: `"Nutriexa" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: `${otp} is your Nutriexa verification code`,
        html: htmlContent,
      });
      console.log(`✅ [Nodemailer] OTP email sent successfully to ${toEmail} (ID: ${info.messageId})`);
      return { success: true, messageId: info.messageId, provider: "nodemailer" };
    } catch (nmErr) {
      console.error("⚠️ [Nodemailer] Failed to send email via Gmail:", nmErr.message);
      // Fallback to Resend if available
    }
  }

  // Fallback to Resend
  if (resend) {
    try {
      const { data, error } = await resend.emails.send({
        from: FROM_EMAIL,
        to: toEmail,
        subject: `${otp} is your Nutriexa verification code`,
        html: htmlContent,
      });

      if (error) {
        console.error("⚠️ [Resend] Failed to send email:", error);
        throw new Error(error.message || "Failed to send email via Resend.");
      }

      console.log(`✅ [Resend] OTP email sent to ${toEmail} (ID: ${data.id})`);
      return { success: true, messageId: data.id, provider: "resend" };
    } catch (resendErr) {
      console.error("⚠️ [Resend] Sending error:", resendErr.message);
      throw resendErr;
    }
  }

  throw new Error("No working email provider configured (Nodemailer or Resend).");
}

export async function sendEmail({ to, subject, html }) {
  if (nodemailerTransporter) {
    try {
      const info = await nodemailerTransporter.sendMail({
        from: `"Nutriexa" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        html,
      });
      return info;
    } catch (err) {
      console.error("⚠️ [Nodemailer] sendEmail failed:", err.message);
    }
  }

  if (resend) {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });
    if (error) throw new Error(error.message);
    return data;
  }

  throw new Error("No email provider available.");
}

export default { sendOtpEmail, sendEmail };
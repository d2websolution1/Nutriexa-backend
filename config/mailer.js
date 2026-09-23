import nodemailer from "nodemailer";
import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

const MAIL_SECRET = process.env.MAIL_SECRET || "nutriexa_secret_mail_token_2026";
const VERCEL_MAIL_URL = (
  process.env.VERCEL_MAIL_URL || "https://nutriexa-frontend.vercel.app/api/send-email"
).trim();

// 1. Nodemailer Transporter using Gmail SMTP (For local or unblocked environments)
let nodemailerTransporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  nodemailerTransporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    connectionTimeout: 6000,
    greetingTimeout: 6000,
    socketTimeout: 6000,
  });
}

// 2. Resend Client (Backup)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = "Nutriexa <onboarding@resend.dev>";

function buildOtpTemplate(otp, name) {
  const recipientName = name && name !== "Signup Verification" ? name : "Valued Customer";
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; background: #4CAF37; color: #ffffff; font-weight: 900; font-size: 20px; border-radius: 12px; margin-bottom: 10px;">NX</div>
        <h1 style="color: #1a1a1a; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: 0.5px;">NUTRIEXA</h1>
        <p style="color: #4CAF37; font-size: 11px; text-transform: uppercase; margin-top: 4px; letter-spacing: 2px; font-weight: 700;">Nutrition For Excellence</p>
      </div>
      <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 20px 0;" />
      <p style="color: #1a1a1a; font-size: 16px; margin: 0 0 12px 0;">Hello <strong>${recipientName}</strong>,</p>
      <p style="color: #4b5563; font-size: 14px; line-height: 1.6; margin: 0 0 20px 0;">
        Thank you for choosing Nutriexa. Please use the following 6-digit verification code to complete your verification:
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
}

/**
 * Sends email via Vercel Serverless Function proxy (Bypasses Render SMTP port blocking)
 */
async function sendViaVercelProxy({ to, otp, name, subject, html }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);

  try {
    const res = await fetch(VERCEL_MAIL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mail-secret": MAIL_SECRET,
      },
      body: JSON.stringify({
        to,
        otp,
        name,
        subject,
        html,
        secret: MAIL_SECRET,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        console.log(`✅ [Vercel Proxy] OTP email sent successfully to ${to} (ID: ${data.messageId})`);
        return { success: true, messageId: data.messageId, provider: "vercel-proxy" };
      }
    }

    const errText = await res.text().catch(() => "");
    throw new Error(`Vercel proxy returned HTTP ${res.status}: ${errText}`);
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Sends email directly via local Nodemailer SMTP
 */
async function sendViaDirectNodemailer({ to, otp, name, subject, html }) {
  if (!nodemailerTransporter) {
    throw new Error("Nodemailer transporter not configured (missing EMAIL_USER or EMAIL_PASS).");
  }

  const emailSubject = subject || (otp ? `${otp} is your Nutriexa verification code` : "Nutriexa Notification");
  const emailHtml = html || (otp ? buildOtpTemplate(otp, name) : `<p>Hello ${name || ""},</p>`);

  const info = await withTimeout(
    nodemailerTransporter.sendMail({
      from: `"Nutriexa" <${process.env.EMAIL_USER}>`,
      to,
      subject: emailSubject,
      html: emailHtml,
    }),
    6000,
    "Direct Nodemailer"
  );

  console.log(`✅ [Direct Nodemailer] Email sent successfully to ${to} (ID: ${info.messageId})`);
  return { success: true, messageId: info.messageId, provider: "nodemailer-direct" };
}

/**
 * Sends email via Brevo REST API over HTTPS port 443 (if configured)
 */
async function sendViaBrevo({ to, otp, name, subject, html }) {
  if (!process.env.BREVO_API_KEY) {
    throw new Error("Brevo API key not configured.");
  }

  const emailSubject = subject || (otp ? `${otp} is your Nutriexa verification code` : "Nutriexa Notification");
  const emailHtml = html || (otp ? buildOtpTemplate(otp, name) : `<p>Hello ${name || ""},</p>`);

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": process.env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: {
        name: "Nutriexa",
        email: process.env.EMAIL_USER || "princerajpit5868@gmail.com",
      },
      to: [{ email: to, name: name || "Customer" }],
      subject: emailSubject,
      htmlContent: emailHtml,
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || `Brevo API returned status ${res.status}`);
  }

  const data = await res.json();
  console.log(`✅ [Brevo API] Email sent to ${to} (ID: ${data.messageId})`);
  return { success: true, messageId: data.messageId, provider: "brevo" };
}

/**
 * Sends a 6-digit OTP verification email via multi-tier fallback:
 * 1. Direct Nodemailer (if local or unblocked network)
 * 2. Vercel Serverless Function Proxy (Bypasses Render SMTP port blocking via HTTPS)
 * 3. Brevo API
 * 4. Resend fallback
 */
export async function sendOtpEmail(toEmail, otp, name = "") {
  const errors = [];

  // Try 1: Vercel Proxy (Works 100% on Render over HTTPS port 443)
  try {
    return await sendViaVercelProxy({ to: toEmail, otp, name });
  } catch (err) {
    errors.push(`Vercel Proxy: ${err.message}`);
    console.warn("⚠️ Vercel mail proxy failed, trying Direct Nodemailer:", err.message);
  }

  // Try 2: Direct Nodemailer (Works on local machine or unblocked hosts)
  try {
    return await sendViaDirectNodemailer({ to: toEmail, otp, name });
  } catch (err) {
    errors.push(`Direct Nodemailer: ${err.message}`);
    console.warn("⚠️ Direct Nodemailer failed:", err.message);
  }

  // Try 3: Brevo API (if configured)
  try {
    return await sendViaBrevo({ to: toEmail, otp, name });
  } catch (err) {
    errors.push(`Brevo: ${err.message}`);
  }

  // Try 4: Resend fallback
  if (resend) {
    try {
      const emailHtml = buildOtpTemplate(otp, name);
      const { data, error } = await withTimeout(
        resend.emails.send({
          from: FROM_EMAIL,
          to: toEmail,
          subject: `${otp} is your Nutriexa verification code`,
          html: emailHtml,
        }),
        6000,
        "Resend email send"
      );

      if (error) throw new Error(error.message || "Resend failed.");
      console.log(`✅ [Resend] OTP email sent to ${toEmail} (ID: ${data.id})`);
      return { success: true, messageId: data.id, provider: "resend" };
    } catch (resendErr) {
      errors.push(`Resend: ${resendErr.message}`);
      console.warn("⚠️ Resend failed:", resendErr.message);
    }
  }

  throw new Error(`Email delivery failed across all providers: ${errors.join("; ")}`);
}

export async function sendEmail({ to, subject, html }) {
  try {
    return await sendViaVercelProxy({ to, subject, html });
  } catch (err) {
    console.warn("⚠️ Vercel proxy sendEmail failed, trying Direct Nodemailer:", err.message);
  }

  try {
    return await sendViaDirectNodemailer({ to, subject, html });
  } catch (err) {
    console.warn("⚠️ Direct Nodemailer sendEmail failed:", err.message);
  }

  throw new Error("No working email provider available.");
}

const withTimeout = async (task, timeoutMs, label) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

export default { sendOtpEmail, sendEmail };
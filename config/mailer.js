import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const sendOtpEmail = async (toEmail, otp, purpose = "Verification") => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn("⚠️ EMAIL_USER or EMAIL_PASS not configured in .env");
    return;
  }

  await transporter.sendMail({
    from: `"Nutriexa Nutrition" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: `${otp} is your Nutriexa ${purpose} Code`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #f4f6f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="min-height: 100vh; padding: 40px 10px;">
          <tr>
            <td align="center">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 480px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05); border: 1px solid #eaeaea;">
                <!-- Header -->
                <tr>
                  <td style="background-color: #1a1a1a; padding: 28px 24px; text-align: center;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">
                      NUTRI<span style="color: #4CAF37;">EXA</span>
                    </h1>
                    <p style="margin: 4px 0 0 0; color: #a0a0a0; font-size: 10px; letter-spacing: 2px; text-transform: uppercase;">
                      Nutrition For Excellence
                    </p>
                  </td>
                </tr>

                <!-- Content -->
                <tr>
                  <td style="padding: 36px 32px; text-align: center;">
                    <h2 style="margin: 0 0 8px 0; color: #1a1a1a; font-size: 20px; font-weight: 700;">
                      ${purpose} Code
                    </h2>
                    <p style="margin: 0 0 24px 0; color: #666666; font-size: 14px; line-height: 1.5;">
                      Use the following one-time password (OTP) to securely complete your request on Nutriexa:
                    </p>

                    <!-- OTP Box -->
                    <div style="background-color: #f7fbf6; border: 2px dashed #4CAF37; border-radius: 12px; padding: 18px 24px; margin: 0 auto 24px auto; display: inline-block;">
                      <span style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #1a1a1a;">
                        ${otp}
                      </span>
                    </div>

                    <p style="margin: 0 0 20px 0; color: #888888; font-size: 12px; line-height: 1.4;">
                      ⏱️ This code is valid for <strong>10 minutes</strong>. Do not share this OTP with anyone, including Nutriexa representatives.
                    </p>

                    <div style="height: 1px; background-color: #f0f0f0; margin: 24px 0;"></div>

                    <p style="margin: 0; color: #999999; font-size: 11px;">
                      If you did not request this OTP code, please safely disregard this email.
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background-color: #fafbf9; padding: 16px 24px; text-align: center; border-top: 1px solid #f0f0f0;">
                    <p style="margin: 0; color: #999999; font-size: 11px;">
                      &copy; ${new Date().getFullYear()} Nutriexa Supplements. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
  });
};
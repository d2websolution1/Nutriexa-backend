import dotenv from "dotenv";
dotenv.config();

/**
 * Send real SMS OTP to Indian mobile numbers.
 * Supports Fast2SMS, 2Factor.in, and Twilio.
 */
export async function sendOtpSms(phoneNumber, otp) {
  const cleanPhone = (phoneNumber || "").toString().replace(/\D/g, "").slice(-10);
  
  if (!cleanPhone || cleanPhone.length < 10) {
    throw new Error("Invalid mobile number format.");
  }

  // 1. FAST2SMS (India OTP gateway)
  if (process.env.FAST2SMS_API_KEY) {
    try {
      // Try Route 1: OTP route
      let response = await fetch("https://www.fast2sms.com/dev/bulkV2", {
        method: "POST",
        headers: {
          authorization: process.env.FAST2SMS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          variables_values: otp,
          route: "otp",
          numbers: cleanPhone,
        }),
      });

      let data = await response.json();

      // If OTP route requires verification, try Quick SMS route
      if (!data.return && (data.status_code === 996 || data.status_code === 999)) {
        console.log("ℹ️ Fast2SMS trying fallback Quick route...");
        response = await fetch("https://www.fast2sms.com/dev/bulkV2", {
          method: "POST",
          headers: {
            authorization: process.env.FAST2SMS_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            route: "q",
            message: `Your Nutriexa verification code is: ${otp}. Valid for 10 mins.`,
            numbers: cleanPhone,
          }),
        });
        data = await response.json();
      }

      console.log(`📱 Fast2SMS response for ${cleanPhone}:`, data);
      return { success: data.return === true, data };
    } catch (err) {
      console.error("❌ Fast2SMS error:", err.message);
    }
  }

  // 2. 2FACTOR.IN
  if (process.env.TWO_FACTOR_API_KEY) {
    try {
      const apiKey = process.env.TWO_FACTOR_API_KEY;
      const url = `https://2factor.in/API/V1/${apiKey}/SMS/${cleanPhone}/${otp}/Nutriexa_OTP`;
      const response = await fetch(url);
      const data = await response.json();
      console.log(`📱 2Factor response for ${cleanPhone}:`, data);
      return { success: data.Status === "Success", data };
    } catch (err) {
      console.error("❌ 2Factor.in error:", err.message);
    }
  }

  // 3. TWILIO
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
    try {
      const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
      const formattedPhone = `+91${cleanPhone}`;
      
      const bodyParams = new URLSearchParams({
        To: formattedPhone,
        From: process.env.TWILIO_PHONE_NUMBER,
        Body: `Your Nutriexa verification OTP code is: ${otp}. Valid for 10 minutes.`,
      });

      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: bodyParams.toString(),
        }
      );

      const data = await response.json();
      console.log(`📱 Twilio SMS response for ${cleanPhone}:`, data.sid || data.message);
      return { success: !data.error_code, data };
    } catch (err) {
      console.error("❌ Twilio error:", err.message);
    }
  }

  console.log(`📱 [SMS Logger] Mobile OTP for +91 ${cleanPhone}: ${otp}`);
  return { success: true, simulated: true };
}

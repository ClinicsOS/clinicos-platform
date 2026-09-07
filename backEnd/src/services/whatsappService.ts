/**
 * Sends WhatsApp template messages via Meta's WhatsApp Cloud API (HTTPS),
 * following the exact same pattern as services/adminMailer.ts and
 * services/mailer.ts (native fetch, dev-mode console fallback when
 * credentials aren't configured yet — so this never crashes local dev).
 *
 * NEW FILE — does not touch any existing service.
 */

const apiVersion = process.env.WHATSAPP_API_VERSION || "v22.0";
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || "";

export interface WhatsAppSendResult {
  success: boolean;
  error?: string;
}

/**
 * Sends an approved WhatsApp template message.
 *
 * @param toPhone       Digits-only international format, e.g. "9627XXXXXXXX"
 *                       (use utils/phone.ts normalizeJordanPhone first).
 * @param templateName  Exact name of the approved template in WhatsApp Manager.
 * @param languageCode  Template language code, e.g. "ar".
 * @param bodyParams    Values for the template's {{1}}, {{2}}, ... placeholders,
 *                       in order.
 */
export async function sendWhatsAppTemplate(
  toPhone: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[]
): Promise<WhatsAppSendResult> {
  if (!phoneNumberId || !accessToken) {
    console.log("═══════════════════════════════════════════════════");
    console.log("📱 [WHATSAPP SERVICE — dev mode, no credentials configured]");
    console.log("To:       ", toPhone);
    console.log("Template: ", templateName, `(${languageCode})`);
    console.log("Params:   ", bodyParams);
    console.log("═══════════════════════════════════════════════════");
    return { success: true };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: toPhone,
          type: "template",
          template: {
            name: templateName,
            language: { code: languageCode },
            components: [
              {
                type: "body",
                parameters: bodyParams.map((text) => ({ type: "text", text })),
              },
            ],
          },
        }),
      }
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`WhatsApp API ${res.status}: ${errBody}`);
    }

    console.log(`[WHATSAPP SERVICE] ✔ Sent "${templateName}" to ${toPhone}`);
    return { success: true };
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[WHATSAPP SERVICE] ✗ Failed to send to ${toPhone}:`, message);
    return { success: false, error: message };
  }
}

/**
 * Sends admin-composed emails using the Resend Email API (HTTPS) — the same
 * transport used by services/mailer.ts. Previously this used raw SMTP
 * (Brevo), which suffers the same intermittent "Connection timeout" issue
 * on Render as the rest of the app used to before the switch to Resend.
 */

const apiKey = process.env.RESEND_API_KEY || "";
const mailFromEmail = process.env.MAIL_FROM_EMAIL || "no-reply@clinicosjo.com";
const mailFromName = process.env.MAIL_FROM_NAME || "ClinicOS";

const wrap = (title: string, bodyText: string) => {
  // Convert plain-text line breaks into <p> tags without breaking on empty lines
  const paragraphs = bodyText
    .split(/\n\n+/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");

  return `
<!doctype html>
<html>
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#0c2e4e">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:40px 20px">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(12,46,78,0.08)">
        <tr><td style="background:linear-gradient(135deg,#06263F 0%,#0c2e4e 100%);padding:24px;text-align:center;color:#ffffff">
          <div style="font-size:22px;font-weight:600;letter-spacing:-0.02em">
            <span style="color:#ffffff">Clinic</span><span style="color:#4FC3B8">OS</span>
          </div>
          <div style="font-size:11px;color:#8fb3cc;margin-top:2px;letter-spacing:0.15em">SMARTER CLINIC MANAGEMENT</div>
        </td></tr>
        <tr><td style="padding:32px 32px 24px 32px">
          <h1 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#0c2e4e">${title}</h1>
          <div style="font-size:14px;line-height:1.65;color:#4b6b85">${paragraphs}</div>
        </td></tr>
        <tr><td style="padding:20px 32px 28px;border-top:1px solid #eef3f8;color:#8095a8;font-size:11px;line-height:1.5">
          ClinicOS · Amman, Jordan · You're receiving this because your account is registered on ClinicOS.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
};

export async function sendAdminCustomEmail(
  to: string,
  recipientName: string,
  subject: string,
  body: string,
): Promise<void> {
  const greeting = recipientName ? `Hi ${recipientName},\n\n` : "";
  const html = wrap(subject, greeting + body);

  if (!apiKey) {
    console.log("═══════════════════════════════════════════════════");
    console.log("📧 [ADMIN MAILER — dev mode, no RESEND_API_KEY configured]");
    console.log("To:      ", to);
    console.log("Subject: ", subject);
    console.log("──────────────────────────────────────────────────");
    console.log(body);
    console.log("═══════════════════════════════════════════════════");
    return;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: `${mailFromName} <${mailFromEmail}>`,
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Resend API ${res.status}: ${errBody}`);
    }
    const data = (await res.json()) as { id?: string };
    console.log(`[ADMIN MAILER] ✔ Sent to ${to} — id: ${data.id}`);
  } catch (err) {
    console.error(`[ADMIN MAILER] ✗ Failed to send to ${to}:`, (err as Error).message);
    throw err; // Rethrow so the API returns an error to the admin
  }
}

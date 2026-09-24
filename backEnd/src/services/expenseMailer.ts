/**
 * NEW FILE — the daily "bills due" email to the clinic owner.
 * Same transport as services/adminMailer.ts (Resend HTTPS API, same env
 * vars, same dev-mode console fallback), but with an Arabic-first, RTL
 * layout listing every bill that needs attention in one digest.
 */
import type { DueItem } from "./expenseSchedule";

const apiKey = process.env.RESEND_API_KEY || "";
const mailFromEmail = process.env.MAIL_FROM_EMAIL || "no-reply@clinicosjo.com";
const mailFromName = process.env.MAIL_FROM_NAME || "ClinicOS";
const mailReplyTo = process.env.MAIL_REPLY_TO || "";
// Same env var services/mailer.ts uses for links back to the dashboard.
const appUrl = (process.env.APP_URL || "https://clinicosjo.com").replace(/\/$/, "");

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const fmtMoney = (n: number) => `${Number(n.toFixed(3))} JD`;

function whenAr(i: DueItem): string {
  if (i.daysUntil < 0) return `متأخر ${Math.abs(i.daysUntil)} يوم`;
  if (i.daysUntil === 0) return "مستحق اليوم";
  if (i.daysUntil === 1) return "مستحق غداً";
  return `بعد ${i.daysUntil} أيام`;
}

function whenEn(i: DueItem): string {
  if (i.daysUntil < 0) return `${Math.abs(i.daysUntil)} day(s) overdue`;
  if (i.daysUntil === 0) return "due today";
  if (i.daysUntil === 1) return "due tomorrow";
  return `in ${i.daysUntil} days`;
}

function buildHtml(ownerName: string, clinicName: string, items: DueItem[]): string {
  const total = items.reduce((s, i) => s + i.amount, 0);
  const rows = items
    .map((i) => {
      const color = i.daysUntil < 0 ? "#d64545" : i.daysUntil === 0 ? "#c77d00" : "#1f7a70";
      const scope = i.scope === "personal" ? "شخصي" : "العيادة";
      return `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #eef3f8">
            <div style="font-size:14px;font-weight:600;color:#0c2e4e">${esc(i.title)}</div>
            <div style="font-size:12px;color:#8095a8;margin-top:2px">${scope} · ${i.dueDate}</div>
          </td>
          <td style="padding:12px 0;border-bottom:1px solid #eef3f8;text-align:left;white-space:nowrap">
            <div style="font-size:14px;font-weight:600;color:#0c2e4e" dir="ltr">${fmtMoney(i.amount)}</div>
            <div style="font-size:12px;font-weight:600;color:${color};margin-top:2px">${whenAr(i)}</div>
          </td>
        </tr>`;
    })
    .join("");

  const enList = items
    .map((i) => `• ${esc(i.title)} — ${fmtMoney(i.amount)} (${whenEn(i)}, ${i.dueDate})`)
    .join("<br>");

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><title>تذكير بالمصاريف</title></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Tahoma,-apple-system,'Segoe UI',Arial,sans-serif;color:#0c2e4e">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
        <tr><td style="background:#06263F;padding:22px;text-align:center" dir="ltr">
          <span style="font-size:22px;font-weight:600;color:#ffffff">Clinic</span><span style="font-size:22px;font-weight:600;color:#4FC3B8">OS</span>
        </td></tr>
        <tr><td style="padding:28px 28px 8px" dir="rtl">
          <div style="font-size:13px;color:#8095a8">${esc(clinicName)}</div>
          <h1 style="margin:6px 0 4px;font-size:19px;color:#0c2e4e">مرحباً ${esc(ownerName)}، عندك ${items.length} ${items.length === 1 ? "دفعة" : "دفعات"} تحتاج انتباهك</h1>
          <div style="font-size:13px;color:#4b6b85">المجموع: <strong dir="ltr">${fmtMoney(total)}</strong></div>
        </td></tr>
        <tr><td style="padding:4px 28px 8px" dir="rtl">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>
        </td></tr>
        <tr><td style="padding:16px 28px 24px;text-align:center">
          <a href="${appUrl}/expenses" style="display:inline-block;background:#4FC3B8;color:#06263F;text-decoration:none;font-weight:600;font-size:14px;padding:11px 26px;border-radius:8px">فتح صفحة المصاريف</a>
          <div style="font-size:12px;color:#8095a8;margin-top:10px">بعد الدفع اضغط «تم الدفع» حتى يتوقف التذكير لهذا الشهر.</div>
        </td></tr>
        <tr><td style="padding:18px 28px 24px;border-top:1px solid #eef3f8;font-size:12px;line-height:1.6;color:#8095a8" dir="ltr">
          <strong style="color:#4b6b85">Payment reminder</strong><br>${enList}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendExpenseReminderEmail(
  to: string,
  ownerName: string,
  clinicName: string,
  items: DueItem[]
): Promise<void> {
  const overdue = items.some((i) => i.daysUntil < 0);
  const subject = overdue
    ? `تذكير: دفعات متأخرة في ${clinicName}`
    : `تذكير: دفعات مستحقة قريباً في ${clinicName}`;

  if (!apiKey) {
    console.log("═══════════════════════════════════════════════════");
    console.log("📧 [EXPENSE MAILER — dev mode, no RESEND_API_KEY configured]");
    console.log("To:      ", to);
    console.log("Subject: ", subject);
    for (const i of items) console.log(` • ${i.title} — ${i.amount} JD — ${whenEn(i)} (${i.dueDate})`);
    console.log("═══════════════════════════════════════════════════");
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: `${mailFromName} <${mailFromEmail}>`,
      to: [to],
      subject,
      html: buildHtml(ownerName, clinicName, items),
      ...(mailReplyTo ? { reply_to: mailReplyTo } : {}),
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Resend API ${res.status}: ${errBody}`);
  }
  console.log(`[EXPENSE MAILER] ✔ Sent to ${to}`);
}

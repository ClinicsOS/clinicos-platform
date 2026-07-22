"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { adminApi, adminErrMsg } from "@/lib/adminApi";
import { IconMail, IconSend, IconTemplate } from "@tabler/icons-react";

interface ClinicOption {
  _id: string;
  name: string;
  slug: string;
}

const TEMPLATES = [
  {
    label: "Renewal reminder",
    subject: "Your ClinicOS subscription is expiring soon",
    body: `We noticed your ClinicOS subscription will expire in the coming days.

To continue enjoying uninterrupted service, please renew your subscription from your dashboard, or reply to this email if you'd like assistance.

Thank you for choosing ClinicOS.`,
  },
  {
    label: "Welcome new subscriber",
    subject: "Welcome to ClinicOS!",
    body: `Welcome aboard! We're thrilled to have your clinic on ClinicOS.

Here are a few things to get you started:

1. Complete your clinic profile in Settings
2. Add your working hours and slot duration
3. Invite your doctors and receptionists
4. Share your public booking link with patients

If you need any help, we're just an email away. Reach out anytime.`,
  },
  {
    label: "Payment confirmed",
    subject: "Payment received — your plan is active",
    body: `Thank you! We've received your payment and your subscription has been activated.

You'll find your updated plan details in your dashboard under Settings → Subscription.

If you have any questions, please reply to this email.`,
  },
  {
    label: "Custom message",
    subject: "",
    body: "",
  },
];

function EmailContent() {
  const params = useSearchParams();
  const initialClinicId = params.get("clinicId") || "";

  const [clinicId, setClinicId] = useState(initialClinicId);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null);

  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const showToast = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3500);
  };

  const { data } = useQuery<{ clinics: ClinicOption[] }>({
    queryKey: ["admin", "clinics-options"],
    queryFn: async () => (await adminApi.get("/admin/clinics?limit=50&sort=name")).data,
  });

  useEffect(() => {
    if (initialClinicId) setClinicId(initialClinicId);
  }, [initialClinicId]);

  const send = useMutation({
    mutationFn: async () =>
      (await adminApi.post("/admin/email/send", { clinicId, subject, body })).data,
    onSuccess: (data) => {
      showToast("success", data.message);
      setSubject("");
      setBody("");
      setSelectedTemplate(null);
    },
    onError: (e) => showToast("error", adminErrMsg(e, "Failed to send email")),
  });

  const applyTemplate = (i: number) => {
    setSelectedTemplate(i);
    setSubject(TEMPLATES[i].subject);
    setBody(TEMPLATES[i].body);
  };

  return (
    <div className="p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-white">Send Email</h1>
        <p className="mt-1 text-[12px] text-red-200/50">
          Compose and send a branded email to a clinic&apos;s owner.
        </p>
      </header>

      {message && (
        <div
          className={`mb-4 rounded-md border p-3 text-[12px] ${
            message.type === "success"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              : "border-red-500/40 bg-red-500/10 text-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Compose */}
        <div className="rounded-lg border border-red-900/30 bg-[#150606]/60 p-5 lg:col-span-2">
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-red-200/50">
            To (clinic)
          </label>
          <select
            value={clinicId}
            onChange={(e) => setClinicId(e.target.value)}
            className="mb-4 w-full rounded-md border border-red-900/40 bg-black/30 px-3 py-2 text-[12px] text-white focus:border-red-500 focus:outline-none"
          >
            <option value="">Select a clinic...</option>
            {data?.clinics.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name} (/{c.slug})
              </option>
            ))}
          </select>

          <label className="mb-1 block text-[10px] uppercase tracking-wider text-red-200/50">
            Subject
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Your ClinicOS subscription"
            maxLength={200}
            className="mb-4 w-full rounded-md border border-red-900/40 bg-black/30 px-3 py-2 text-[12px] text-white focus:border-red-500 focus:outline-none"
          />

          <label className="mb-1 block text-[10px] uppercase tracking-wider text-red-200/50">
            Body
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            placeholder="Write your message here...

We'll wrap this in the ClinicOS branded email template automatically. Just plain text — line breaks are preserved."
            maxLength={10000}
            className="mb-2 w-full rounded-md border border-red-900/40 bg-black/30 px-3 py-2 text-[12px] text-white focus:border-red-500 focus:outline-none"
          />
          <div className="mb-4 text-right text-[10px] text-red-200/40">
            {body.length} / 10,000
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] text-red-200/50">
              <IconMail size={12} className="mr-1 inline" />
              Sent from {process.env.NEXT_PUBLIC_MAIL_FROM || "ClinicOS"}
            </div>
            <button
              onClick={() => send.mutate()}
              disabled={send.isPending || !clinicId || !subject.trim() || !body.trim()}
              className="flex items-center gap-1.5 rounded-md bg-red-600 px-4 py-2 text-[12px] font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconSend size={13} />
              {send.isPending ? "Sending..." : "Send Email"}
            </button>
          </div>
        </div>

        {/* Templates */}
        <div className="rounded-lg border border-red-900/30 bg-[#150606]/60 p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <IconTemplate size={14} /> Templates
          </h3>
          <div className="space-y-2">
            {TEMPLATES.map((t, i) => (
              <button
                key={i}
                onClick={() => applyTemplate(i)}
                className={`block w-full rounded-md border p-3 text-start text-[11px] transition ${
                  selectedTemplate === i
                    ? "border-red-500 bg-red-600/20 text-white"
                    : "border-red-900/40 bg-black/20 text-red-100/70 hover:bg-red-900/20 hover:text-white"
                }`}
              >
                <div className="font-medium">{t.label}</div>
                {t.subject && (
                  <div className="mt-0.5 truncate text-[10px] text-red-200/50">
                    {t.subject}
                  </div>
                )}
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-md border border-red-900/20 bg-black/30 p-3 text-[10px] text-red-200/50">
            💡 The email will be sent to the clinic&apos;s owner (whoever registered the clinic).
            All sends are logged in the activity log.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function EmailPage() {
  return (
    <Suspense fallback={<div className="p-6 text-[12px] text-red-200/50">Loading...</div>}>
      <EmailContent />
    </Suspense>
  );
}

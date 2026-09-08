"use client";

import { useEffect, useRef, useState } from "react";
import { IconX, IconSend2 } from "@tabler/icons-react";
import { api, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/store/auth";
import Cube3D from "@/components/Cube3D";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

type QuickReplyKey = "about" | "pricing" | "booking" | "track";

// Two SEPARATE threads, not one — a visitor's browsing history must never
// bleed into a logged-in staff member's dashboard session (or vice versa).
// Mixing them meant Claude would see its own earlier "what's your phone
// number?" turn from before login and keep following that pattern, even
// though the system prompt had switched to dashboard mode. Splitting the
// storage key is what actually fixes that — the dashboard thread now
// starts completely clean the first time a signed-in user opens the chat.
const STORAGE_KEY_PUBLIC = "clinicos-chat-conversation-id-public";
const STORAGE_KEY_DASHBOARD = "clinicos-chat-conversation-id-dashboard";

const BOT_NAME = { ar: "نبض", en: "Nabd" };
const BOT_SUBTITLE = { ar: "مساعد ClinicOS الذكي", en: "ClinicOS's smart assistant" };
const GREETING_PUBLIC = {
  ar: "مرحباً 👋 أنا نبض، مساعد ClinicOS. كيف أقدر أساعدك؟",
  en: "Hi 👋 I'm Nabd, the ClinicOS assistant. How can I help?",
};
const GREETING_DASHBOARD = {
  ar: "أهلاً 👋 أنا نبض. اسألني عن مواعيد اليوم، ابحث عن مريض، أو خليني أساعدك تحجز أو تفوتر.",
  en: "Hi 👋 I'm Nabd. Ask me about today's appointments, search for a patient, or let me help you book or invoice.",
};
const PLACEHOLDER = { ar: "اكتب رسالتك...", en: "Type your message..." };
const ERROR_FALLBACK = {
  ar: "نبض مش قادر يرد هلأ، جرب كمان شوي 🙏",
  en: "Nabd can't reply right now — please try again shortly 🙏",
};

const QUICK_REPLIES: { key: QuickReplyKey; label: { ar: string; en: string } }[] = [
  { key: "about", label: { ar: "تعرف على ClinicOS", en: "Learn about ClinicOS" } },
  { key: "pricing", label: { ar: "الأسعار", en: "Pricing" } },
  { key: "booking", label: { ar: "كيف بحجز موعد؟", en: "How do I book?" } },
  { key: "track", label: { ar: "تتبع حجزي", en: "Track my booking" } },
];

export function ChatWindow({ onClose }: { onClose: () => void }) {
  const { lang } = useI18n();
  const isAuthed = !!useAuth((s) => s.token);
  const storageKey = isAuthed ? STORAGE_KEY_DASHBOARD : STORAGE_KEY_PUBLIC;
  const greeting = isAuthed ? GREETING_DASHBOARD[lang] : GREETING_PUBLIC[lang];

  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "assistant", content: greeting }]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const conversationIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Re-read (and re-greet) whenever the auth state flips — logging in or
  // out mid-session switches which stored thread we're continuing.
  useEffect(() => {
    conversationIdRef.current = window.localStorage.getItem(storageKey);
    setMessages([{ role: "assistant", content: greeting }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const postMessage = async (text: string, quickReplyKey?: QuickReplyKey) => {
    setMessages((m) => [...m, { role: "user", content: text }]);
    setSending(true);

    try {
      const { data } = await api.post<{ conversationId: string; reply: string }>(
        "/chat/message",
        {
          message: text,
          conversationId: conversationIdRef.current || undefined,
          quickReplyKey,
          lang,
        }
      );
      conversationIdRef.current = data.conversationId;
      window.localStorage.setItem(storageKey, data.conversationId);
      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: errMsg(e, ERROR_FALLBACK[lang]) }]);
    } finally {
      setSending(false);
    }
  };

  const send = () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    postMessage(text);
  };

  const sendQuickReply = (key: QuickReplyKey, label: string) => {
    if (sending) return;
    postMessage(label, key);
  };

  // Quick-reply pills are a public-site thing only — the dashboard greeting
  // already tells staff what they can ask instead.
  const showQuickReplies = !isAuthed && messages.length === 1;

  return (
    <div className="mb-3 w-[380px] max-w-[92vw] h-[560px] max-h-[78vh] rounded-2xl border border-edge bg-card shadow-2xl flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-edge bg-gradient-to-r from-card2 to-card">
        <div className="w-9 h-9 rounded-full bg-soft flex items-center justify-center overflow-hidden shrink-0">
          <Cube3D size={24} spin={false} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-ink leading-tight">{BOT_NAME[lang]}</div>
          <div className="text-[11px] text-mute leading-tight">{BOT_SUBTITLE[lang]}</div>
        </div>
        <button
          onClick={onClose}
          className="text-mute hover:text-ink transition p-1 rounded-full hover:bg-soft"
          aria-label="close"
        >
          <IconX size={18} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`fade-up flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-teal text-navy rounded-br-sm"
                  : "bg-soft text-ink border border-edge rounded-bl-sm"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {sending && (
          <div className="fade-up flex justify-start">
            <div className="bg-soft border border-edge rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1 items-center">
              <span className="w-1.5 h-1.5 rounded-full bg-mute animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-mute animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-mute animate-bounce" />
            </div>
          </div>
        )}

        {showQuickReplies && (
          <div className="fade-up flex flex-wrap gap-2 pt-1">
            {QUICK_REPLIES.map((q) => (
              <button
                key={q.key}
                onClick={() => sendQuickReply(q.key, q.label[lang])}
                className="pill !text-xs !px-3 !py-1.5 border border-edge bg-soft text-ink hover:border-sky hover:brightness-110 transition"
              >
                {q.label[lang]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="p-3 border-t border-edge flex items-center gap-2">
        <input
          className="inp flex-1 !rounded-full"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={PLACEHOLDER[lang]}
          disabled={sending}
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          className="w-10 h-10 shrink-0 rounded-full bg-teal text-navy flex items-center justify-center hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition"
          aria-label={lang === "ar" ? "إرسال" : "Send"}
        >
          <IconSend2 size={18} className={lang === "ar" ? "rtl-flip" : ""} />
        </button>
      </div>
    </div>
  );
}

// CLINICOS CONNECT (C2) — shapes of the C1 API (backEnd/src/services/connect/*). Dates arrive as ISO strings.
// Nothing here is trusted for security: the server decides who may see what on every request.

export type ConversationType = "direct" | "clinic_team";

/** C4 — a message is plain text, or a REFERENCE to a ClinicOS record. The message never carries the record's data. */
export type ContentType = "text" | "appointment_reference" | "patient_reference";
export type RefType = "appointment" | "patient";
export interface RefInput {
  type: RefType;
  id: string;
}

/** name / role / isActive only — the API never sends a colleague's e-mail or phone. */
export interface Person {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
}

export interface LastMessage {
  id: string;
  senderId: string;
  isMine: boolean;
  preview: string;
  /** C4: "text" (also for every message written before C4) | "appointment_reference" | "patient_reference". The preview of a card message holds only the sender's optional note. */
  contentType?: ContentType;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  type: ConversationType;
  createdAt: string;
  lastMessageAt: string | null;
  lastMessage: LastMessage | null;
  unreadCount: number;
  participants?: Person[];
  /** direct: the other participant. */
  peer?: Person | null;
  /** team: number of ACTIVE staff. */
  memberCount?: number;
  /** direct (C3): how far the OTHER participant has read, as an opaque cursor (null = nothing yet). Drives "Seen". */
  peerLastReadCursor?: string | null;
}

export interface ConversationList {
  conversations: ConversationSummary[];
  totalUnread: number;
}

export interface UnreadSummary {
  total: number;
  conversations: { conversationId: string; unreadCount: number }[];
}

export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  sender: Person | null;
  /** The sender's note (may be empty for a card message). */
  text: string;
  /** C4. Absent on payloads from before C4 → read as "text". */
  contentType?: ContentType;
  createdAt: string;
  /** Opaque, usable as `before` / `after`. Encodes the message's per-conversation sequence number. */
  cursor: string;
}

export interface PageInfo {
  hasMoreOlder: boolean;
  hasMoreNewer: boolean;
  olderCursor: string | null;
  newerCursor: string | null;
}

export interface MessagePage {
  messages: MessageDto[];
  pageInfo: PageInfo;
}

/** A message the user typed that the server has not (yet) confirmed. Lives only in the browser. */
export interface PendingMessage {
  clientId: string;
  conversationId: string;
  text: string;
  /** C4: a card being sent. `card` is what the SENDER just saw in the picker — shown while sending, never sent to the server. */
  reference?: RefInput;
  card?: CardView;
  createdAt: string;
  status: "sending" | "failed";
  /** failed: true when the request got no answer at all (so the server MAY have stored it). */
  uncertain?: boolean;
  /** failed: machine code from the server, when there was an answer. */
  code?: string;
}

/** Everything the chat pane needs about one conversation's messages. */
export interface ThreadState {
  /** Server-confirmed messages, oldest → newest, unique by id. */
  messages: MessageDto[];
  hasMoreOlder: boolean;
  olderCursor: string | null;
  newerCursor: string | null;
  pending: PendingMessage[];
}

/** An eligible colleague for "New Message": from GET /users, filtered to active + not me. Only these fields are ever kept. */
export interface StaffPerson {
  id: string;
  name: string;
  role: string;
}

/* ------------------------------------------------------------------ realtime events (C3) — see docs/connect-c3.md for the contract */
/** Every server → client event carries `v`. A payload this client does not understand is ignored (HTTP reconciliation still repairs the screen). */
export const RT_VERSION = 1 as const;

export interface RtPerson {
  id: string;
  name: string;
  role: string;
}

/** connect:message:new — a message was PERSISTED by C1; `unreadCount` is the recipient's own count for that conversation (0 for the sender's other devices). */
export interface RtMessageEvent {
  v: 1;
  conversation: { id: string; type: ConversationType };
  message: { id: string; conversationId: string; senderId: string; sender: RtPerson | null; text: string; contentType?: ContentType; createdAt: string; cursor: string };
  preview: string;
  lastMessageAt: string;
  unreadCount: number;
}

/** connect:read:self — my read position moved (in another tab, or here): my new unread count for that conversation. */
export interface RtReadSelfEvent {
  v: 1;
  conversationId: string;
  unreadCount: number;
  lastReadCursor: string | null;
}

/** connect:read:peer — DIRECT conversations only: how far the other participant has read (→ "Seen"). */
export interface RtReadPeerEvent {
  v: 1;
  conversationId: string;
  lastReadCursor: string | null;
}

/** connect:typing — ephemeral; the identity is resolved by the server. */
export interface RtTypingEvent {
  v: 1;
  conversationId: string;
  userId: string;
  name: string;
  role: string;
  typing: boolean;
}

/* ------------------------------------------------------------------ C4: cards (resolved per viewer by POST /connect/conversations/:id/cards) */
export interface PatientCardData {
  id: string;
  fullName: string;
  fileNumber: number;
}
export interface AppointmentCardData {
  id: string;
  startAt: string;
  /** Clinic-calendar day YYYY-MM-DD (for the schedule deep link). */
  day: string;
  duration: number;
  status: string;
  patientName: string | null;
  doctorName: string | null;
}
export type RefContentType = Exclude<ContentType, "text">;
/** What the card of one message looks like to THIS viewer, right now. `restricted` and `unavailable` carry no data at all. */
export type CardView =
  | { messageId: string; contentType: "patient_reference"; state: "ok"; patient: PatientCardData }
  | { messageId: string; contentType: "appointment_reference"; state: "ok"; appointment: AppointmentCardData }
  | { messageId: string; contentType: RefContentType; state: "restricted" | "unavailable" };
export type CardMap = Record<string, CardView>;

export interface PatientPickerPage {
  patients: PatientCardData[];
  page: number;
  hasMore: boolean;
}
export type ApptGroup = "today" | "upcoming" | "recent";
export interface AppointmentPickerPage {
  appointments: AppointmentCardData[];
  group: ApptGroup;
  page: number;
  hasMore: boolean;
}

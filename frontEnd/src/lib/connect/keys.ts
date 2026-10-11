// CLINICOS CONNECT — React Query keys (C2), in their own module so the realtime layer can use them without importing the hooks.
// Every key carries the signed-in user's id: a different account in the same browser never sees another account's cache.
export const connectKeys = {
  list: (uid: string) => ["connect", uid, "list"] as const,
  unread: (uid: string) => ["connect", uid, "unread"] as const,
  thread: (uid: string, id: string) => ["connect", uid, "thread", id] as const,
  staff: (uid: string) => ["connect", uid, "staff"] as const,
  // C4: cards and picker lists depend on WHO is looking (their role decides what they may see): user- and role-scoped, and everything under
  // ["connect"] is removed when the signed-in user changes or logs out (lib/providers.tsx).
  cards: (uid: string, role: string, id: string) => ["connect", uid, "cards", role, id] as const,
  pickPatients: (uid: string, role: string, q: string) => ["connect", uid, "pick", role, "patients", q] as const,
  pickAppts: (uid: string, role: string, group: string, q: string) => ["connect", uid, "pick", role, "appointments", group, q] as const,
};

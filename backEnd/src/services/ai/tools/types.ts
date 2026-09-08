/**
 * What a tool is allowed to know about who's asking, when it executes.
 * The AI never sees or sets any of this — the controller builds it from
 * req.userId/clinicId/role (set by optionalAuth) and the loaded
 * Conversation document, and passes it into every tool.execute() call.
 */
export interface ToolContext {
  conversationId: string;        // public id (cookie/localStorage-facing)
  conversationObjectId: string;  // Mongo _id of the Conversation document
  clinicId?: string;
  userId?: string;
  role?: "owner" | "doctor" | "receptionist";
}

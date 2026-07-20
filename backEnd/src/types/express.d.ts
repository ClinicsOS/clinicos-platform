declare global {
  namespace Express {
    interface Request {
      userId?: string;
      clinicId?: string;
      role?: "owner" | "doctor" | "receptionist";
    }
  }
}
export {};

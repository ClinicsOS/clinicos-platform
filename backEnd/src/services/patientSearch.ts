/** Escapes user input so it can be used safely inside a RegExp. */
const escapeRegex = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // PHASE 7 — a NUL / control character makes MongoDB reject the pattern (was a 500)

/**
 * The ONE patient search filter (clinic-scoped, archived hidden, name / phone / e-mail with tolerant phone digits).
 * Used by GET /api/patients AND by the ClinicOS Connect patient picker (C4), so both always search the same way.
 * `includeArchived` / `fileNumber` are only used by Connect (finding the appointments of an archived patient, searching "1024").
 */
export function patientSearchFilter(
  clinicId: string | undefined,
  rawSearch: string,
  opts: { includeArchived?: boolean; fileNumber?: boolean } = {}
): Record<string, any> {
  const search = String(rawSearch || "").trim().slice(0, 60);
  const filter: Record<string, any> = { clinicId };
  if (!opts.includeArchived) filter.isArchived = false;
  if (search) {
    // Escaped so characters like "(" or "+" can't crash the query.
    const rx = new RegExp(escapeRegex(search), "i");
    const or: Record<string, unknown>[] = [{ fullName: rx }, { phone: rx }, { email: rx }];
    // Phone numbers are often stored with spaces ("079 123 4567") — match
    // the digits even when the user types them without spaces.
    const digits = search.replace(/\D/g, "");
    if (digits.length >= 3) or.push({ phone: new RegExp(digits.split("").join("\\D*")) });
    if (opts.fileNumber && /^\d{1,9}$/.test(search)) or.push({ fileNumber: Number(search) });
    filter.$or = or;
  }
  return filter;
}


// PHASE 4 — Treatment Plan <-> Dental Chart sync: user-facing error / status copy, English + Arabic (RTL-safe plain text).
export const treatmentSyncEn: Record<string, string> = {
  "ts.err.locked": "This treatment can no longer be changed here. Start a new one if the plan needs correcting.",
  "ts.err.changed": "This treatment was updated by someone else a moment ago. The latest version is shown — please review and try again.",
  "ts.err.gone": "This patient or treatment is no longer available to you.",
  "ts.err.network": "No connection. Nothing was changed — please try again.",
  "ts.err.generic": "Couldn't save the change. Nothing was changed — please try again.",
  "ts.err.cancel": "Couldn't cancel this treatment. It was restored — please try again.",
  "ts.saving": "Saving…",
  "ts.updating": "Updating…",
};
export const treatmentSyncAr: Record<string, string> = {
  "ts.err.locked": "لا يمكن تعديل هذا العلاج من هنا بعد الآن. أضف علاجًا جديدًا إذا كانت الخطة تحتاج تصحيحًا.",
  "ts.err.changed": "تم تحديث هذا العلاج من قبل شخص آخر قبل لحظات. تم عرض آخر نسخة — راجعها وحاول مرة أخرى.",
  "ts.err.gone": "هذا المريض أو العلاج لم يعد متاحًا لك.",
  "ts.err.network": "لا يوجد اتصال. لم يتم تغيير أي شيء — حاول مرة أخرى.",
  "ts.err.generic": "تعذّر حفظ التغيير. لم يتم تغيير أي شيء — حاول مرة أخرى.",
  "ts.err.cancel": "تعذّر إلغاء هذا العلاج. تمت استعادته — حاول مرة أخرى.",
  "ts.saving": "جارٍ الحفظ…",
  "ts.updating": "جارٍ التحديث…",
};

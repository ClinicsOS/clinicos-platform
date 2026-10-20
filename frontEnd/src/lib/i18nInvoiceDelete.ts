// PHASE 2 — invoice deletion lifecycle (soft delete → Deleted Invoices → restore / permanent delete): every string, English + Arabic.
// Placeholders: {no} = "INV-0012", {amount} = "30.00", {date}, {name}.
export const invoiceDeleteEn: Record<string, string> = {
  "invd.tab.active": "Active Invoices",
  "invd.tab.deleted": "Deleted Invoices",
  "invd.tabs.aria": "Invoice views",
  "invd.delete": "Delete invoice",

  // ----- move to Deleted Invoices -----
  "invd.del.title": "Delete Invoice?",
  "invd.del.body": "This invoice will be moved to Deleted Invoices. You can restore it later.",
  "invd.del.patient": "Patient",
  "invd.del.paidWarn": "{amount} JD of payments are recorded on this invoice. While it is deleted they are not counted in revenue or reports. Restoring it brings them back.",
  "invd.del.reason": "Reason for deletion (optional)",
  "invd.del.reasonPh": "e.g. entered twice",
  "invd.del.confirm": "Move to Deleted Invoices",
  "invd.del.done": "Moved to Deleted Invoices",
  "invd.del.doneBody": "{no} can be restored from the Deleted Invoices tab.",

  // ----- restore -----
  "invd.res.title": "Restore Invoice {no}?",
  "invd.res.body": "It returns to Active Invoices exactly as it was — same number, amounts and payments — and counts in revenue and reports again.",
  "invd.res.confirm": "Restore Invoice",
  "invd.res.done": "Invoice restored",
  "invd.res.doneBody": "{no} is back in Active Invoices.",

  // ----- permanent delete -----
  "invd.purge.btn": "Delete permanently",
  "invd.purge.title": "Permanently Delete Invoice?",
  "invd.purge.body": "Invoice {no} will be permanently removed. This action cannot be undone.",
  "invd.purge.type": "To confirm, type the invoice number",
  "invd.purge.confirm": "Delete permanently",
  "invd.purge.done": "Invoice permanently deleted",
  "invd.purge.doneBody": "{no} was removed.",

  // ----- Deleted Invoices panel -----
  "invd.notice": "Deleted invoices are not counted in revenue, reports or totals. Restore one to bring it back exactly as it was.",
  "invd.empty.title": "No deleted invoices",
  "invd.empty.body": "Invoices you delete are kept here until you restore them or delete them permanently.",
  "invd.empty.bodyNoPurge": "Invoices you delete are kept here until you restore them. Only the clinic owner can delete an invoice permanently.",
  "invd.noMatch": "No deleted invoice matches “{q}”.",
  "invd.badge": "Deleted",
  "invd.deletedOn": "Deleted {date}",
  "invd.by": "by {name}",
  "invd.reason": "Reason",
  "invd.noReason": "No reason given",
  "invd.restore": "Restore",
  "invd.gone": "This invoice is no longer available. The list was refreshed.",
  "invd.count": "{n} deleted",
};

export const invoiceDeleteAr: Record<string, string> = {
  "invd.tab.active": "الفواتير الفعّالة",
  "invd.tab.deleted": "الفواتير المحذوفة",
  "invd.tabs.aria": "عروض الفواتير",
  "invd.delete": "حذف الفاتورة",

  "invd.del.title": "حذف الفاتورة؟",
  "invd.del.body": "سيتم نقل هذه الفاتورة إلى الفواتير المحذوفة، ويمكنك استرجاعها لاحقاً.",
  "invd.del.patient": "المريض",
  "invd.del.paidWarn": "يوجد دفعات بقيمة {amount} JD مسجّلة على هذه الفاتورة. أثناء حذفها لا تُحتسب في الإيرادات أو التقارير، وعند استرجاعها تعود كما كانت.",
  "invd.del.reason": "سبب الحذف (اختياري)",
  "invd.del.reasonPh": "مثال: تم إدخالها مرتين",
  "invd.del.confirm": "نقل إلى الفواتير المحذوفة",
  "invd.del.done": "تم النقل إلى الفواتير المحذوفة",
  "invd.del.doneBody": "يمكنك استرجاع {no} من تبويب الفواتير المحذوفة.",

  "invd.res.title": "استرجاع الفاتورة {no}؟",
  "invd.res.body": "ستعود إلى الفواتير الفعّالة كما كانت تماماً — نفس الرقم والمبالغ والدفعات — وتُحتسب من جديد في الإيرادات والتقارير.",
  "invd.res.confirm": "استرجاع الفاتورة",
  "invd.res.done": "تم استرجاع الفاتورة",
  "invd.res.doneBody": "{no} عادت إلى الفواتير الفعّالة.",

  "invd.purge.btn": "حذف نهائي",
  "invd.purge.title": "حذف الفاتورة نهائياً؟",
  "invd.purge.body": "سيتم حذف الفاتورة {no} نهائياً ولا يمكن التراجع عن هذا الإجراء.",
  "invd.purge.type": "للتأكيد، اكتب رقم الفاتورة",
  "invd.purge.confirm": "حذف نهائي",
  "invd.purge.done": "تم حذف الفاتورة نهائياً",
  "invd.purge.doneBody": "تمت إزالة {no}.",

  "invd.notice": "الفواتير المحذوفة لا تُحتسب في الإيرادات أو التقارير أو المجاميع. استرجع الفاتورة لتعود كما كانت تماماً.",
  "invd.empty.title": "لا توجد فواتير محذوفة",
  "invd.empty.body": "الفواتير التي تحذفها تُحفظ هنا إلى أن تسترجعها أو تحذفها نهائياً.",
  "invd.empty.bodyNoPurge": "الفواتير التي تحذفها تُحفظ هنا إلى أن تسترجعها. وحده مالك العيادة يستطيع حذف الفاتورة نهائياً.",
  "invd.noMatch": "لا توجد فاتورة محذوفة مطابقة لـ «{q}».",
  "invd.badge": "محذوفة",
  "invd.deletedOn": "حُذفت {date}",
  "invd.by": "بواسطة {name}",
  "invd.reason": "السبب",
  "invd.noReason": "بدون سبب",
  "invd.restore": "استرجاع",
  "invd.gone": "هذه الفاتورة لم تعد متاحة. تم تحديث القائمة.",
  "invd.count": "{n} محذوفة",
};

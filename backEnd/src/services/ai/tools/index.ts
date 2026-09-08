import type { AIToolDefinition } from "../AIProvider";
import type { ToolContext } from "./types";
import { getPricingDefinition, getPricingExecute } from "./getPricing";
import { createLeadDefinition, createLeadExecute } from "./createLead";
import { listDoctorsDefinition, listDoctorsExecute } from "./dashboard/listDoctors";
import { getClinicStatsDefinition, getClinicStatsExecute } from "./dashboard/getClinicStats";
import {
  listTodayAppointmentsDefinition,
  listTodayAppointmentsExecute,
} from "./dashboard/listTodayAppointments";
import { searchPatientsDefinition, searchPatientsExecute } from "./dashboard/searchPatients";
import { createPatientDefinition, createPatientExecute } from "./dashboard/createPatient";
import { createAppointmentDefinition, createAppointmentExecute } from "./dashboard/createAppointment";
import { cancelAppointmentDefinition, cancelAppointmentExecute } from "./dashboard/cancelAppointment";
import { createInvoiceDefinition, createInvoiceExecute } from "./dashboard/createInvoice";

export type { ToolContext } from "./types";

export interface RegisteredTool {
  definition: AIToolDefinition;
  requiresConfirmation?: boolean;
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<Record<string, unknown>>;
}

const publicTools: Record<string, RegisteredTool> = {
  getPricing: { definition: getPricingDefinition, execute: getPricingExecute },
  createLead: { definition: createLeadDefinition, execute: createLeadExecute },
};

const dashboardTools: Record<string, RegisteredTool> = {
  listDoctors: { definition: listDoctorsDefinition, execute: listDoctorsExecute },
  getClinicStats: { definition: getClinicStatsDefinition, execute: getClinicStatsExecute },
  listTodayAppointments: {
    definition: listTodayAppointmentsDefinition,
    execute: listTodayAppointmentsExecute,
  },
  searchPatients: { definition: searchPatientsDefinition, execute: searchPatientsExecute },
  createPatient: {
    definition: createPatientDefinition,
    execute: createPatientExecute,
    requiresConfirmation: true,
  },
  createAppointment: {
    definition: createAppointmentDefinition,
    execute: createAppointmentExecute,
    requiresConfirmation: true,
  },
  cancelAppointment: {
    definition: cancelAppointmentDefinition,
    execute: cancelAppointmentExecute,
    requiresConfirmation: true,
  },
  createInvoice: {
    definition: createInvoiceDefinition,
    execute: createInvoiceExecute,
    requiresConfirmation: true,
  },
};

/**
 * Returns the tools the AI is allowed to call for this request.
 *
 * ctx.clinicId only ever gets set from a verified JWT — never from
 * anything the AI or the message body says — so gating on it here is the
 * real security boundary, not just a convenience filter.
 */
export function getAllowedTools(ctx: ToolContext): Record<string, RegisteredTool> {
  if (ctx.clinicId) {
    return { ...publicTools, ...dashboardTools };
  }
  return publicTools;
}

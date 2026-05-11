// Tool dispatcher — routes tool calls from VAPI's webhook to the right handler.
//
// VAPI's webhook payload includes a `toolCallList` of one or more tool invocations,
// each with a function name and JSON-string arguments. The dispatcher:
//   1. Looks up the handler by tool name
//   2. Parses the JSON arguments
//   3. Invokes the handler with the parsed args + request context
//   4. Returns the typed ToolResult
//
// Unknown tool names return a structured error rather than throwing — protects
// against the LLM hallucinating tool names that aren't registered.

import type { ToolContext, ToolHandler, ToolResult } from './types.js';
import { lookupPatient } from './lookupPatient/handler.js';
import { registerPatient } from './registerPatient/handler.js';
import { listProviders } from './listProviders/handler.js';
import { findAvailableSlots } from './findAvailableSlots/handler.js';
import { bookAppointment } from './bookAppointment/handler.js';
import { listPatientAppointments } from './listPatientAppointments/handler.js';
import { cancelAppointment } from './cancelAppointment/handler.js';
import { rescheduleAppointment } from './rescheduleAppointment/handler.js';

// Registry: tool name → handler. New tools get added here.
// The keys MUST match the function names configured in the VAPI assistant
// (e.g., the LLM emits `lookup_patient`, this map routes that to the handler).
const handlers: Record<string, ToolHandler> = {
    lookup_patient: lookupPatient,
    register_patient: registerPatient,
    list_providers: listProviders,
    find_available_slots: findAvailableSlots,
    book_appointment: bookAppointment,
    list_patient_appointments: listPatientAppointments,
    cancel_appointment: cancelAppointment,
    reschedule_appointment: rescheduleAppointment,
};

export async function dispatchTool(
    toolName: string,
    rawArgs: unknown,
    ctx: ToolContext,
): Promise<ToolResult> {
    const handler = handlers[toolName];
    if (!handler) {
        return {
            ok: false,
            error: `Unknown tool: ${toolName}`,
        };
    }

    return handler(rawArgs, ctx);
}

// Exposed for the webhook layer if it wants to validate VAPI's tool config
// against the registered handlers at startup.
export function getRegisteredToolNames(): string[] {
    return Object.keys(handlers);
}

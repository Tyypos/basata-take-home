// list_patient_appointments — show the caller their appointments,
// hydrated with provider names.
//
// Conversational flow this supports:
//   1. Caller asks "what appointments do I have?" or wants to reschedule/cancel
//      something but can't remember the details.
//   2. Agent calls this; reads back what's relevant. The returned ids feed
//      into cancel_appointment and reschedule_appointment.
//
// Default scope is "future + scheduled" — the cases the caller most often
// means. Two flags relax that:
//   - include_past:       client-side, lets the caller hear last-week visits
//   - include_cancelled:  pass-through to EMR, only when explicitly asked
//
// Returns one of two statuses:
//   - success: 1+ appointments after filtering. Provider names are hydrated.
//   - none:    no appointments after filtering. LLM should offer to widen
//              (include_past, include_cancelled) or offer to book one.

import { z } from 'zod';
import { getProvider, listAppointments } from '../../emr/api/index.js';
import { EmrError } from '../../emr/errors.js';
import type { ToolHandler } from '../types.js';
import { createLogger } from '../../util/logger.js';
import type { Appointment, Provider } from '../../emr/types.js';

const argsSchema = z
    .object({
        patient_id: z.string().min(1),
        include_past: z.boolean().optional(),
        include_cancelled: z.boolean().optional(),
    })
    .strict();

export const listPatientAppointments: ToolHandler = async (rawArgs, ctx) => {
    const log = createLogger(ctx.requestId);

    const parsed = argsSchema.safeParse(rawArgs);
    if (!parsed.success) {
        const error = `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join('; ')}`;
        log.warn('list_patient_appointments: invalid args', {
            issues: parsed.error.issues,
        });
        return { ok: false, error };
    }

    const {
        patient_id,
        include_past = false,
        include_cancelled = false,
    } = parsed.data;
    log.info('list_patient_appointments: listing', {
        include_past,
        include_cancelled,
    });

    try {
        const appointments = await listAppointments({
            patient_id,
            include_cancelled,
        });
        log.info('list_patient_appointments: emr returned', {
            emrCount: appointments.length,
        });

        // Client-side: drop past appointments unless caller asked otherwise.
        // EMR returns naive timestamps; new Date() parses them in server-local
        // time, which is the comparison we want against Date.now().
        const now = Date.now();
        const visible = include_past
            ? appointments
            : appointments.filter(
                  (a) => new Date(a.start_time).getTime() >= now,
              );

        if (visible.length === 0) {
            log.info('list_patient_appointments: none', {
                emrCount: appointments.length,
            });
            return { ok: true, data: { status: 'none' } };
        }

        // Hydrate provider names. Batch unique IDs in parallel.
        const uniqueProviderIds = [
            ...new Set(visible.map((a) => a.provider_id)),
        ];
        const providers = await Promise.all(
            uniqueProviderIds.map((id) => getProvider(id)),
        );
        const byId = new Map<string, Provider>(providers.map((p) => [p.id, p]));

        const hydrated = visible.map((a) =>
            toHydratedAppointment(a, byId.get(a.provider_id)),
        );

        log.info('list_patient_appointments: returning', {
            returnedCount: hydrated.length,
        });
        return {
            ok: true,
            data: { status: 'success', appointments: hydrated },
        };
    } catch (err) {
        if (err instanceof EmrError) {
            log.error('list_patient_appointments: EMR error', {
                name: err.name,
                message: err.message,
            });
            return {
                ok: false,
                error: 'I had trouble pulling up your appointments. Let me transfer you to someone who can help.',
            };
        }
        throw err;
    }
};

function toHydratedAppointment(a: Appointment, provider: Provider | undefined) {
    const provider_name = provider
        ? `Dr. ${provider.first_name} ${provider.last_name}, ${provider.title}`
        : 'our provider';
    return {
        id: a.id,
        start_time: a.start_time,
        end_time: a.end_time,
        provider_name,
        appointment_type: a.appointment_type,
        status: a.status,
        reason: a.reason,
        is_telehealth: a.is_telehealth,
    };
}

// book_appointment — book the slot the caller picked from a recent
// find_available_slots result.
//
// Conversational flow this supports:
//   1. Caller saw 2-3 slots from find_available_slots and picked one.
//   2. Agent confirms the details out loud ("Tuesday at 10 AM with Dr. Martinez,
//      correct?") then calls book_appointment.
//   3. On success → agent confirms naturally; appointment.id stays internal
//      for any follow-on cancel/reschedule.
//
// Races: in between the slot search and the book call, another caller might
// grab the slot. The EMR returns 409 in that case. We surface it as a clean
// `slot_taken` status so the LLM can offer to find another slot, instead of
// "something went wrong, transferring you."
//
// Returns one of three statuses:
//   - success:     appointment booked. provider_name is hydrated for speech.
//   - slot_taken:  409 conflict — the slot is no longer available. LLM should
//                  re-run find_available_slots and offer alternates.
//   - failed:      any other EMR failure. LLM apologizes and offers transfer.

import { z } from 'zod';
import {
    bookAppointment as bookAppointmentApi,
    getProvider,
} from '../../emr/api/index.js';
import { EmrConflictError, EmrError } from '../../emr/errors.js';
import type { ToolHandler } from '../types.js';
import { createLogger } from '../../util/logger.js';

const APPOINTMENT_TYPES = [
    'new_patient',
    'follow_up',
    'procedure_consult',
    'stress_test',
    'telehealth',
] as const;

// ISO 8601 timestamp. Timezone is optional — the EMR returns naive local
// timestamps (e.g. `2026-05-11T16:00:00`) and we pass them through verbatim
// from find_available_slots into book_appointment. We don't validate calendar
// correctness here; the EMR is the source of truth on whether the timestamp
// matches a real slot.
const ISO_8601_RE =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

const argsSchema = z
    .object({
        patient_id: z.string().min(1),
        provider_id: z.string().min(1),
        start_time: z
            .string()
            .regex(ISO_8601_RE, 'start_time must be ISO 8601 with timezone'),
        appointment_type: z.enum(APPOINTMENT_TYPES),
        reason: z.string().min(1).optional(),
    })
    .strict();

export const bookAppointment: ToolHandler = async (rawArgs, ctx) => {
    const log = createLogger(ctx.requestId);

    const parsed = argsSchema.safeParse(rawArgs);
    if (!parsed.success) {
        const error = `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join('; ')}`;
        log.warn('book_appointment: invalid args', {
            issues: parsed.error.issues,
        });
        return { ok: false, error };
    }

    const args = parsed.data;
    log.info('book_appointment: booking', {
        provider_id: args.provider_id,
        start_time: args.start_time,
        appointment_type: args.appointment_type,
        hasReason: args.reason !== undefined,
    });

    try {
        const appointment = await bookAppointmentApi(args);
        log.info('book_appointment: booked');

        // Hydrate provider name for speech. The booking already succeeded —
        // a failure here shouldn't propagate as a tool failure. Fall back to
        // a neutral label and log so it's still visible.
        let provider_name = 'our provider';
        try {
            const provider = await getProvider(appointment.provider_id);
            provider_name = `Dr. ${provider.first_name} ${provider.last_name}, ${provider.title}`;
        } catch (hydrationErr) {
            log.warn('book_appointment: provider hydration failed', {
                name: (hydrationErr as Error)?.name,
                message: (hydrationErr as Error)?.message,
            });
        }

        return {
            ok: true,
            data: {
                status: 'success',
                appointment: {
                    id: appointment.id,
                    provider_name,
                    start_time: appointment.start_time,
                    is_telehealth: appointment.is_telehealth,
                },
            },
        };
    } catch (err) {
        if (err instanceof EmrConflictError) {
            // Race lost: slot taken between search and book. Surface cleanly
            // so the LLM can re-run find_available_slots.
            log.warn('book_appointment: slot_taken', {
                provider_id: args.provider_id,
            });
            return { ok: true, data: { status: 'slot_taken' } };
        }
        if (err instanceof EmrError) {
            log.error('book_appointment: EMR error', {
                name: err.name,
                message: err.message,
            });
            return {
                ok: false,
                error: 'I had trouble booking that appointment. Let me transfer you to someone who can help.',
            };
        }
        throw err;
    }
};

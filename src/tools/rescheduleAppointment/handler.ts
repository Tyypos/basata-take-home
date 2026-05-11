// reschedule_appointment — server-orchestrated reschedule.
//
// Composite operation: there is no EMR "reschedule" endpoint, so we
// compose it ourselves as a three-step sequence with explicit failure
// handling at each step.
//
// Ordering rationale (book-new-then-cancel-old):
//   - If the new booking fails, the caller still has the original. Worst
//     case: they hang up with what they came in with.
//   - If we cancelled first and then the new booking failed, the caller
//     would lose their appointment entirely. That's the worse failure mode.
//
// Patient ID derivation: this tool does NOT take patient_id as an arg.
// The original appointment's patient_id is the source of truth for the new
// booking — read it off the fetched appointment. This means cross-patient
// access is not enforced here; the assumption is that lookup_patient ran
// earlier in the conversation, and a production system would carry a
// verified patient_id through the call context to gate this tool.
//
// Returns one of five statuses:
//   - success                      — new booked, old cancelled
//   - slot_taken                   — new slot was 409 (race lost); old intact
//   - original_not_found           — original id doesn't exist
//   - original_not_scheduled       — original exists but is cancelled/completed/no_show
//   - manual_intervention_required — new booked but cancel of old failed
//                                    twice; needs an operator
//   - failed                       — any other EMR failure; caller transferred

import { z } from 'zod';
import {
    bookAppointment as bookAppointmentApi,
    cancelAppointment as cancelAppointmentApi,
    getAppointment,
    getProvider,
} from '../../emr/api/index.js';
import {
    EmrConflictError,
    EmrError,
    EmrNotFoundError,
} from '../../emr/errors.js';
import type { ToolHandler } from '../types.js';
import { createLogger } from '../../util/logger.js';
import type { Provider } from '../../emr/types.js';

const APPOINTMENT_TYPES = [
    'new_patient',
    'follow_up',
    'procedure_consult',
    'stress_test',
    'telehealth',
] as const;

// Same ISO regex as book_appointment — EMR returns naive timestamps and we
// pass them through verbatim from find_available_slots.
const ISO_8601_RE =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

const argsSchema = z
    .object({
        appointment_id: z.string().min(1),
        new_start_time: z
            .string()
            .regex(ISO_8601_RE, 'new_start_time must be ISO 8601'),
        new_provider_id: z.string().min(1),
        appointment_type: z.enum(APPOINTMENT_TYPES),
        reason: z.string().min(1).optional(),
    })
    .strict();

export const rescheduleAppointment: ToolHandler = async (rawArgs, ctx) => {
    const log = createLogger(ctx.requestId);

    const parsed = argsSchema.safeParse(rawArgs);
    if (!parsed.success) {
        const error = `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join('; ')}`;
        log.warn('reschedule_appointment: invalid args', {
            issues: parsed.error.issues,
        });
        return { ok: false, error };
    }

    const {
        appointment_id,
        new_start_time,
        new_provider_id,
        appointment_type,
        reason,
    } = parsed.data;

    log.info('reschedule_appointment: starting', {
        appointment_type,
        hasReason: reason !== undefined,
    });

    // ── Step 1: validate the original appointment. ─────────────────────────
    let original;
    try {
        original = await getAppointment(appointment_id);
    } catch (err) {
        if (err instanceof EmrNotFoundError) {
            log.info('reschedule_appointment: original_not_found');
            return { ok: true, data: { status: 'original_not_found' } };
        }
        if (err instanceof EmrError) {
            log.error('reschedule_appointment: original fetch failed', {
                name: err.name,
                message: err.message,
            });
            return { ok: true, data: { status: 'failed' } };
        }
        throw err;
    }

    if (original.status !== 'scheduled') {
        log.info('reschedule_appointment: original_not_scheduled', {
            originalStatus: original.status,
        });
        return { ok: true, data: { status: 'original_not_scheduled' } };
    }

    // Patient_id is derived, not user-supplied. The new booking inherits
    // ownership from the original.
    const patient_id = original.patient_id;

    // ── Step 2: book the new appointment. No mutation has happened yet —
    //    a failure here leaves the original intact, which is the desired
    //    failure mode.
    let newAppointment;
    try {
        newAppointment = await bookAppointmentApi({
            patient_id,
            provider_id: new_provider_id,
            start_time: new_start_time,
            appointment_type,
            ...(reason !== undefined ? { reason } : {}),
        });
    } catch (err) {
        if (err instanceof EmrConflictError) {
            log.warn('reschedule_appointment: slot_taken');
            return { ok: true, data: { status: 'slot_taken' } };
        }
        if (err instanceof EmrError) {
            log.error('reschedule_appointment: new booking failed', {
                name: err.name,
                message: err.message,
            });
            return { ok: true, data: { status: 'failed' } };
        }
        throw err;
    }
    log.info('reschedule_appointment: new booked');

    // ── Step 3: cancel the old appointment. From here, partial failure is
    //    possible — the new booking is committed and cannot be cleanly
    //    rolled back (the EMR would 409 anyone else trying to claim the
    //    slot we just took, and there is no "uncancel" endpoint either).
    //    Single retry, no backoff. If both attempts fail, escalate.
    let cancelSucceeded = false;
    let firstCancelErr: Error | undefined;
    try {
        await cancelAppointmentApi(appointment_id);
        cancelSucceeded = true;
    } catch (err) {
        firstCancelErr = err as Error;
        log.warn(
            'reschedule_appointment: cancel of original failed, retrying once',
            {
                name: firstCancelErr?.name,
                message: firstCancelErr?.message,
            },
        );
        try {
            await cancelAppointmentApi(appointment_id);
            cancelSucceeded = true;
        } catch (retryErr) {
            // Loud error — an operator needs to see this. The IDs are
            // surfaced in the response (the LLM will speak the new
            // appointment time, and operations can reconcile via the
            // VAPI call log keyed by this requestId).
            log.error(
                'reschedule_appointment: manual_intervention_required — new appointment booked but cancel of original failed twice; operator must reconcile',
                {
                    firstErrName: firstCancelErr?.name,
                    firstErrMessage: firstCancelErr?.message,
                    retryErrName: (retryErr as Error)?.name,
                    retryErrMessage: (retryErr as Error)?.message,
                },
            );
        }
    }

    if (!cancelSucceeded) {
        return {
            ok: true,
            data: {
                status: 'manual_intervention_required',
                new_appointment_id: newAppointment.id,
                original_appointment_id: appointment_id,
            },
        };
    }

    // ── Hydrate provider names for the success response. Batch unique IDs
    //    in parallel; same provider on both ends = one fetch.
    let new_provider_name = 'our provider';
    let cancelled_provider_name = 'our provider';
    try {
        const uniqueIds = [
            ...new Set([newAppointment.provider_id, original.provider_id]),
        ];
        const providers = await Promise.all(
            uniqueIds.map((id) => getProvider(id)),
        );
        const byId = new Map<string, Provider>(providers.map((p) => [p.id, p]));
        const np = byId.get(newAppointment.provider_id);
        const op = byId.get(original.provider_id);
        if (np) {
            new_provider_name = `Dr. ${np.first_name} ${np.last_name}, ${np.title}`;
        }
        if (op) {
            cancelled_provider_name = `Dr. ${op.first_name} ${op.last_name}, ${op.title}`;
        }
    } catch (hydrationErr) {
        log.warn('reschedule_appointment: provider hydration failed', {
            name: (hydrationErr as Error)?.name,
            message: (hydrationErr as Error)?.message,
        });
    }

    log.info('reschedule_appointment: success');
    return {
        ok: true,
        data: {
            status: 'success',
            new_appointment: {
                id: newAppointment.id,
                provider_name: new_provider_name,
                start_time: newAppointment.start_time,
                is_telehealth: newAppointment.is_telehealth,
            },
            cancelled_appointment: {
                provider_name: cancelled_provider_name,
                start_time: original.start_time,
            },
        },
    };
};

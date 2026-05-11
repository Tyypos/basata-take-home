// cancel_appointment — cancel a specific scheduled appointment.
//
// Conversational flow this supports:
//   1. Caller has been identified and (usually) listed their appointments,
//      picking one to cancel.
//   2. Agent confirms verbally ("Just to confirm, you want to cancel your
//      Tuesday 10 AM appointment with Dr. Martinez?") then calls this tool.
//   3. On success → agent confirms naturally. Caller can request a new slot.
//
// We always pre-fetch the appointment so we can:
//   - Distinguish 404 (caller-confused id, or an id we never minted)
//   - Detect "already cancelled" without a wasted DELETE call
//   - Hydrate provider name + start_time for the spoken response
//
// Returns one of three statuses:
//   - success:            appointment cancelled. provider_name + start_time
//                         hydrated so the LLM can read back what was cancelled.
//   - not_found:          no appointment with that id. LLM should offer to
//                         list the caller's appointments and try again.
//   - already_cancelled:  it was already cancelled. provider_name + start_time
//                         are returned so the LLM can clarify gracefully
//                         ("It looks like that one's already cancelled.").

import { z } from 'zod';
import {
    cancelAppointment as cancelAppointmentApi,
    getAppointment,
    getProvider,
} from '../../emr/api/index.js';
import { EmrError, EmrNotFoundError } from '../../emr/errors.js';
import type { ToolHandler } from '../types.js';
import { createLogger } from '../../util/logger.js';

const argsSchema = z
    .object({
        appointment_id: z.string().min(1),
    })
    .strict();

export const cancelAppointment: ToolHandler = async (rawArgs, ctx) => {
    const log = createLogger(ctx.requestId);

    const parsed = argsSchema.safeParse(rawArgs);
    if (!parsed.success) {
        const error = `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join('; ')}`;
        log.warn('cancel_appointment: invalid args', {
            issues: parsed.error.issues,
        });
        return { ok: false, error };
    }

    const { appointment_id } = parsed.data;
    log.info('cancel_appointment: validating');

    // Step 1: pre-fetch the appointment. 404 short-circuits cleanly.
    let appointment;
    try {
        appointment = await getAppointment(appointment_id);
    } catch (err) {
        if (err instanceof EmrNotFoundError) {
            log.info('cancel_appointment: not_found');
            return { ok: true, data: { status: 'not_found' } };
        }
        if (err instanceof EmrError) {
            log.error('cancel_appointment: pre-fetch EMR error', {
                name: err.name,
                message: err.message,
            });
            return {
                ok: false,
                error: 'I had trouble cancelling that appointment. Let me transfer you to someone who can help.',
            };
        }
        throw err;
    }

    // Hydrate provider name once — used in both already_cancelled and success
    // responses. A hydration failure falls back to a neutral label rather
    // than blocking the cancel; matches the book_appointment pattern.
    let provider_name = 'our provider';
    try {
        const provider = await getProvider(appointment.provider_id);
        provider_name = `Dr. ${provider.first_name} ${provider.last_name}, ${provider.title}`;
    } catch (hydrationErr) {
        log.warn('cancel_appointment: provider hydration failed', {
            name: (hydrationErr as Error)?.name,
            message: (hydrationErr as Error)?.message,
        });
    }

    // Step 2: already cancelled? Don't make a redundant DELETE call.
    if (appointment.status === 'cancelled') {
        log.info('cancel_appointment: already_cancelled');
        return {
            ok: true,
            data: {
                status: 'already_cancelled',
                appointment: {
                    provider_name,
                    start_time: appointment.start_time,
                },
            },
        };
    }

    // Step 3: perform the cancel.
    try {
        await cancelAppointmentApi(appointment_id);
        log.info('cancel_appointment: cancelled');
        return {
            ok: true,
            data: {
                status: 'success',
                appointment: {
                    provider_name,
                    start_time: appointment.start_time,
                    status: 'cancelled',
                },
            },
        };
    } catch (err) {
        if (err instanceof EmrError) {
            log.error('cancel_appointment: cancel EMR error', {
                name: err.name,
                message: err.message,
            });
            return {
                ok: false,
                error: 'I had trouble cancelling that appointment. Let me transfer you to someone who can help.',
            };
        }
        throw err;
    }
};

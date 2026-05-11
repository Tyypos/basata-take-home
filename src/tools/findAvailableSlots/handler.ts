// find_available_slots — search the EMR for appointment slots matching the
// caller's preferences, hydrated with provider names for the LLM to speak.
//
// Conversational flow this supports:
//   1. Caller has been identified (patient_id known) and the visit type
//      decided (appointment_type known — first-timers always = new_patient).
//   2. Caller mentions preferences: a date range, "mornings only," a
//      specific provider, "the soonest you have."
//   3. Agent calls find_available_slots; reads back at most 2-3 options.
//   4. Caller picks one → book_appointment with the chosen slot's start_time.
//
// EMR client already caps results at 3 (voice UX guardrail), so the LLM
// can't accidentally hear a 12-slot list.
//
// Defensive filtering: even though slots come back from an EMR `/slots`
// search that's scoped by appointment_type, we double-check each slot's
// supported_appointment_types — the EMR doesn't enforce
// provider/appointment-type compatibility on its own.
//
// Provider hydration: unique provider_ids are fetched in parallel via
// Promise.all. The LLM needs "Dr. Sofia Martinez, MD" not "prov_martinez".
//
// Returns one of two statuses:
//   - success:    1-3 slots, each enriched with provider_name. Read 2-3 aloud.
//   - no_slots:   no slots matched. `searched_with` echoes the filters used
//                 so the LLM can ask the caller about widening criteria.

import { z } from 'zod';
import { findSlots, getProvider } from '../../emr/api/index.js';
import { EmrError } from '../../emr/errors.js';
import type { ToolHandler } from '../types.js';
import { createLogger } from '../../util/logger.js';
import type { Provider, Slot } from '../../emr/types.js';

const APPOINTMENT_TYPES = [
    'new_patient',
    'follow_up',
    'procedure_consult',
    'stress_test',
    'telehealth',
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
// MON,TUE,WED,THU,FRI,SAT,SUN — comma-separated, no spaces. EMR expects
// upper-case three-letter codes; we keep that contract here.
const DAYS_RE =
    /^(MON|TUE|WED|THU|FRI|SAT|SUN)(,(MON|TUE|WED|THU|FRI|SAT|SUN))*$/;

const argsSchema = z
    .object({
        patient_id: z.string().min(1),
        appointment_type: z.enum(APPOINTMENT_TYPES),
        provider_id: z.string().min(1).optional(),
        start_date: z
            .string()
            .regex(DATE_RE, 'start_date must be YYYY-MM-DD')
            .optional(),
        end_date: z
            .string()
            .regex(DATE_RE, 'end_date must be YYYY-MM-DD')
            .optional(),
        start_time_of_day: z
            .string()
            .regex(TIME_RE, 'start_time_of_day must be HH:MM')
            .optional(),
        end_time_of_day: z
            .string()
            .regex(TIME_RE, 'end_time_of_day must be HH:MM')
            .optional(),
        days_of_week: z
            .string()
            .regex(
                DAYS_RE,
                'days_of_week must be comma-separated codes like MON,WED,FRI',
            )
            .optional(),
        earliest_available: z.boolean().optional(),
    })
    .strict();

type Args = z.infer<typeof argsSchema>;

export const findAvailableSlots: ToolHandler = async (rawArgs, ctx) => {
    const log = createLogger(ctx.requestId);

    const parsed = argsSchema.safeParse(rawArgs);
    if (!parsed.success) {
        const error = `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join('; ')}`;
        log.warn('find_available_slots: invalid args', {
            issues: parsed.error.issues,
        });
        return { ok: false, error };
    }

    const args = parsed.data;
    log.info('find_available_slots: searching', {
        appointment_type: args.appointment_type,
        provider_id: args.provider_id,
        start_date: args.start_date,
        end_date: args.end_date,
        start_time_of_day: args.start_time_of_day,
        end_time_of_day: args.end_time_of_day,
        days_of_week: args.days_of_week,
        earliest_available: args.earliest_available,
    });

    try {
        const slots = await findSlots(args);
        log.info('find_available_slots: emr returned', {
            emrCount: slots.length,
        });

        // Defensive: drop any slot whose provider doesn't actually support
        // the requested appointment type. The EMR `/slots` endpoint doesn't
        // enforce this cross-check.
        const eligible = slots.filter((s) =>
            s.supported_appointment_types.includes(args.appointment_type),
        );

        if (eligible.length === 0) {
            log.info('find_available_slots: no_slots', {
                emrCount: slots.length,
            });
            return {
                ok: true,
                data: {
                    status: 'no_slots',
                    searched_with: buildSearchedWith(args),
                },
            };
        }

        // Hydrate provider name + title. Batch unique IDs in parallel.
        const uniqueProviderIds = [
            ...new Set(eligible.map((s) => s.provider_id)),
        ];
        const providers = await Promise.all(
            uniqueProviderIds.map((id) => getProvider(id)),
        );
        const byId = new Map<string, Provider>(providers.map((p) => [p.id, p]));

        const hydrated = eligible.map((s) =>
            toHydratedSlot(s, byId.get(s.provider_id), args.appointment_type),
        );

        log.info('find_available_slots: returning', {
            returnedCount: hydrated.length,
        });
        return {
            ok: true,
            data: { status: 'success', slots: hydrated },
        };
    } catch (err) {
        if (err instanceof EmrError) {
            log.error('find_available_slots: EMR error', {
                name: err.name,
                message: err.message,
            });
            return {
                ok: false,
                error: 'I had trouble checking our schedule. Let me transfer you to someone who can help.',
            };
        }
        throw err;
    }
};

function buildSearchedWith(args: Args): Record<string, unknown> {
    // Echo back only the fields the LLM actually passed, so it can suggest
    // which ones to widen ("try without the provider filter", "extend the
    // date range"). patient_id is dropped — not a filter the caller chose.
    const out: Record<string, unknown> = {
        appointment_type: args.appointment_type,
    };
    if (args.provider_id !== undefined) out.provider_id = args.provider_id;
    if (args.start_date !== undefined) out.start_date = args.start_date;
    if (args.end_date !== undefined) out.end_date = args.end_date;
    if (args.start_time_of_day !== undefined)
        out.start_time_of_day = args.start_time_of_day;
    if (args.end_time_of_day !== undefined)
        out.end_time_of_day = args.end_time_of_day;
    if (args.days_of_week !== undefined) out.days_of_week = args.days_of_week;
    if (args.earliest_available !== undefined)
        out.earliest_available = args.earliest_available;
    return out;
}

function toHydratedSlot(
    slot: Slot,
    provider: Provider | undefined,
    appointment_type: Args['appointment_type'],
) {
    // Format: "Dr. Sofia Martinez, MD". If the provider lookup somehow missed
    // (shouldn't happen — getProvider would have thrown), fall back to a
    // neutral label rather than crashing the whole search.
    const provider_name = provider
        ? `Dr. ${provider.first_name} ${provider.last_name}, ${provider.title}`
        : 'our provider';
    return {
        provider_id: slot.provider_id,
        provider_name,
        start_time: slot.start_time,
        end_time: slot.end_time,
        is_telehealth: slot.is_telehealth,
        appointment_type,
    };
}

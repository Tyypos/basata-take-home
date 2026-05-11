// register_patient — create a new patient record in the EMR.
//
// Conversational flow this supports:
//   1. lookup_patient returned not_found.
//   2. Agent collects first_name, last_name, date_of_birth, and phone
//      (phone usually from customer.number, verified back to the caller).
//   3. Agent calls register_patient.
//   4. On success → agent greets by first name and proceeds to scheduling.
//
// Strictly minimal field collection: email and insurance are captured at
// in-person check-in, NOT over the phone. The Zod schema rejects any extra
// fields the LLM might try to send so the policy is enforced server-side.
//
// Returns one of three statuses the LLM can act on:
//   - success:            new patient created. Speak the first_name; keep id internal.
//   - already_registered: phone exists AND last_name + DOB match. Treat as a
//                         friendly "you're already in our system" path; id is returned
//                         so subsequent tool calls can use it.
//   - phone_conflict:     phone exists but identity does NOT match. Soft PHI
//                         guardrail: do NOT reveal the existing patient. LLM offers
//                         transfer to a human.

import { z } from 'zod';
import { createPatient, searchPatients } from '../../emr/api/index.js';
import { EmrConflictError, EmrError } from '../../emr/errors.js';
import type { ToolHandler } from '../types.js';
import { createLogger } from '../../util/logger.js';

// LLM-supplied args. All four fields required. `.strict()` so the LLM can't
// sneak email/insurance through — those belong at check-in, not on the phone.
const argsSchema = z
    .object({
        first_name: z.string().min(1),
        last_name: z.string().min(1),
        date_of_birth: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, 'date_of_birth must be YYYY-MM-DD'),
        phone: z
            .string()
            .regex(
                /^\+[1-9]\d{1,14}$/,
                'phone must be E.164 (e.g. +15551234567)',
            ),
    })
    .strict();

export const registerPatient: ToolHandler = async (rawArgs, ctx) => {
    const log = createLogger(ctx.requestId);

    const parsed = argsSchema.safeParse(rawArgs);
    if (!parsed.success) {
        const error = `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join('; ')}`;
        log.warn('register_patient: invalid args', {
            issues: parsed.error.issues,
        });
        return { ok: false, error };
    }

    const { first_name, last_name, date_of_birth, phone } = parsed.data;
    log.info('register_patient: creating', {
        // Names and DOBs are PHI — log only non-identifying signals.
        phoneSuffix: phone.slice(-4),
    });

    try {
        const patient = await createPatient({
            first_name,
            last_name,
            date_of_birth,
            phone,
        });
        log.info('register_patient: created');
        return {
            ok: true,
            data: {
                status: 'success',
                patient: {
                    id: patient.id,
                    first_name: patient.first_name,
                },
            },
        };
    } catch (err) {
        if (err instanceof EmrConflictError) {
            // Phone already exists. Disambiguate: same person re-registering, or
            // a phone collision with a different patient? Look up by phone and
            // compare last_name (case-insensitive) + date_of_birth.
            log.info('register_patient: phone conflict, disambiguating');
            try {
                const existing = await searchPatients({ phone });
                const match = existing.find(
                    (p) =>
                        p.last_name.toLowerCase() === last_name.toLowerCase() &&
                        p.date_of_birth === date_of_birth,
                );

                if (match) {
                    log.info('register_patient: already_registered');
                    return {
                        ok: true,
                        data: {
                            status: 'already_registered',
                            patient: {
                                id: match.id,
                                first_name: match.first_name,
                            },
                        },
                    };
                }

                log.warn(
                    'register_patient: phone_conflict (identity mismatch)',
                    {
                        matchCount: existing.length,
                    },
                );
                // Intentionally omit any patient details — PHI guardrail.
                return {
                    ok: true,
                    data: { status: 'phone_conflict' },
                };
            } catch (lookupErr) {
                if (lookupErr instanceof EmrError) {
                    log.error(
                        'register_patient: conflict disambiguation failed',
                        {
                            name: lookupErr.name,
                            message: lookupErr.message,
                        },
                    );
                    return {
                        ok: false,
                        error: 'I had trouble completing your registration. Let me transfer you to someone who can help.',
                    };
                }
                throw lookupErr;
            }
        }

        if (err instanceof EmrError) {
            log.error('register_patient: EMR error', {
                name: err.name,
                message: err.message,
            });
            return {
                ok: false,
                error: 'I had trouble completing your registration. Let me transfer you to someone who can help.',
            };
        }
        throw err;
    }
};

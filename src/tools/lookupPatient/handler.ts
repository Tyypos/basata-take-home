// lookup_patient — find an existing patient by phone OR last name + DOB.
//
// Conversational flow this supports:
//   1. Caller dials in. Agent calls lookup_patient with caller's phone (from VAPI's customer.number).
//   2. If found → agent greets them by name and proceeds to scheduling/etc.
//   3. If not found → agent asks for last name + DOB, calls lookup_patient again.
//   4. If still not found → agent offers to register them as a new patient.
//
// Returns one of three states the LLM can act on:
//   - found:        single match, return the patient
//   - not_found:    no matches, LLM should re-prompt or offer registration
//   - ambiguous:    multiple matches (rare — e.g., last name + DOB collision),
//                   LLM should ask a clarifying question (e.g., first name)

import { z } from 'zod';
import { searchPatients } from '../../emr/api/index.js';
import { EmrError } from '../../emr/errors.js';
import type { ToolHandler } from '../types.js';
import { createLogger } from '../../util/logger.js';

// LLM-supplied args. At least one of (phone) or (last_name + date_of_birth) is required.
// We accept all three as optional in the schema and validate the OR rule manually
// because Zod's discriminated unions don't express "phone OR (lastName + dob)" cleanly.
const argsSchema = z
    .object({
        phone: z.string().optional(),
        last_name: z.string().optional(),
        date_of_birth: z.string().optional(),
    })
    .refine(
        (args) => !!args.phone || (!!args.last_name && !!args.date_of_birth),
        {
            message:
                'Provide either phone, or both last_name and date_of_birth',
        },
    );

export const lookupPatient: ToolHandler = async (rawArgs, ctx) => {
    const log = createLogger(ctx.requestId);

    const parsed = argsSchema.safeParse(rawArgs);
    if (!parsed.success) {
        const error = `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join('; ')}`;
        log.warn('lookup_patient: invalid args', {
            issues: parsed.error.issues,
        });
        return { ok: false, error };
    }

    log.info('lookup_patient: searching', { params: parsed.data });

    try {
        const patients = await searchPatients(parsed.data);
        log.info('lookup_patient: result', { matchCount: patients.length });

        if (patients.length === 0) {
            return { ok: true, data: { status: 'not_found' } };
        }

        if (patients.length > 1) {
            return {
                ok: true,
                data: { status: 'ambiguous', match_count: patients.length },
            };
        }

        const patient = patients[0]!;
        return {
            ok: true,
            data: {
                status: 'found',
                patient: {
                    id: patient.id,
                    first_name: patient.first_name,
                    last_name: patient.last_name,
                    date_of_birth: patient.date_of_birth,
                },
            },
        };
    } catch (err) {
        if (err instanceof EmrError) {
            log.error('lookup_patient: EMR error', {
                name: err.name,
                message: err.message,
            });
            return {
                ok: false,
                error: 'I had trouble looking up your record. Let me transfer you to someone who can help.',
            };
        }
        throw err;
    }
};

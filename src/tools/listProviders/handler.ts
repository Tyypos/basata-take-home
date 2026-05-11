// list_providers — list cardiology providers, optionally filtered by specialty
// and/or appointment type.
//
// Conversational flow this supports:
//   1. Caller asks "who do you have for X?" or names a specific provider.
//   2. Agent calls list_providers (sometimes with a specialty filter).
//   3. Agent reads back a short summary of relevant providers; honors each
//      provider's `restrictions` text when proposing slots later.
//   4. Agent uses the returned ids in subsequent slot/appointment tool calls.
//
// Filtering split:
//   - `specialty`         → server-side, passed to the EMR
//   - `appointment_type`  → client-side, after the EMR returns. The EMR does
//                           not enforce provider/appointment-type compatibility,
//                           so we double-check here against
//                           supported_appointment_types.
//
// Returns one of two statuses:
//   - success:        one or more providers matched. `providers` array preserves
//                     EMR order (no resorting). Each entry omits `bio` — the
//                     LLM doesn't need it unless the caller asks.
//   - no_providers:   filtered list is empty (rare — only with restrictive
//                     filter combos). LLM should offer to broaden the search.

import { z } from 'zod';
import { listProviders as listProvidersApi } from '../../emr/api/index.js';
import { EmrError } from '../../emr/errors.js';
import type { ToolHandler } from '../types.js';
import { createLogger } from '../../util/logger.js';
import type { Provider } from '../../emr/types.js';

const argsSchema = z
    .object({
        specialty: z
            .enum([
                'general_cardiology',
                'interventional_cardiology',
                'electrophysiology',
            ])
            .optional(),
        appointment_type: z
            .enum([
                'new_patient',
                'follow_up',
                'procedure_consult',
                'stress_test',
                'telehealth',
            ])
            .optional(),
    })
    .strict();

export const listProviders: ToolHandler = async (rawArgs, ctx) => {
    const log = createLogger(ctx.requestId);

    const parsed = argsSchema.safeParse(rawArgs);
    if (!parsed.success) {
        const error = `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join('; ')}`;
        log.warn('list_providers: invalid args', {
            issues: parsed.error.issues,
        });
        return { ok: false, error };
    }

    const { specialty, appointment_type } = parsed.data;
    log.info('list_providers: listing', { specialty, appointment_type });

    try {
        const providers = await listProvidersApi(
            specialty ? { specialty } : {},
        );
        log.info('list_providers: emr returned', {
            emrCount: providers.length,
        });

        // Defensive client-side filter — EMR does not enforce
        // provider/appointment-type compatibility.
        const filtered = appointment_type
            ? providers.filter((p) =>
                  p.supported_appointment_types.includes(appointment_type),
              )
            : providers;

        if (filtered.length === 0) {
            log.info('list_providers: no_providers after filter', {
                emrCount: providers.length,
            });
            return { ok: true, data: { status: 'no_providers' } };
        }

        // Strip `bio` — the LLM doesn't need it unless the caller asks for it,
        // and reciting full bios at random is exactly the kind of voice UX we
        // want to avoid. Preserve EMR order.
        const summarized = filtered.map(toProviderSummary);

        log.info('list_providers: returning', {
            returnedCount: summarized.length,
        });
        return {
            ok: true,
            data: { status: 'success', providers: summarized },
        };
    } catch (err) {
        if (err instanceof EmrError) {
            log.error('list_providers: EMR error', {
                name: err.name,
                message: err.message,
            });
            return {
                ok: false,
                error: 'I had trouble pulling up our provider list. Let me transfer you to someone who can help.',
            };
        }
        throw err;
    }
};

function toProviderSummary(p: Provider) {
    return {
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        title: p.title,
        specialties: p.specialties,
        supported_appointment_types: p.supported_appointment_types,
        restrictions: p.restrictions,
    };
}

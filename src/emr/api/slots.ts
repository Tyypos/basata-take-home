// EMR API wrappers for the Slots resource.
// Searches available appointment slots across providers with rich filtering
// (date range, time of day, days of week, provider, etc.).
// Enforces a hard cap of 3 results regardless of caller input — voice UX
// guardrail to prevent the agent from reading long lists over the phone.

import { http, mapAxiosError } from '../http.js';
import { Slot, SlotSearchParams } from '../types.js';

// Voice UX guardrail: cap slot results at 3 regardless of caller input.
// Reading 10 options over the phone is unusable. Enforced at the client
// layer so the LLM can't override it via tool args.
const MAX_SLOTS_OVER_VOICE = 3;

export async function findSlots(params: SlotSearchParams): Promise<Slot[]> {
    const finalParams: SlotSearchParams = {
        ...params,
        number_of_slots_to_present: Math.min(
            params.number_of_slots_to_present ?? MAX_SLOTS_OVER_VOICE,
            MAX_SLOTS_OVER_VOICE,
        ),
    };

    try {
        const { data } = await http.get<Slot[]>('/slots', {
            params: finalParams,
        });
        return data;
    } catch (err) {
        throw mapAxiosError(err, 'findSlots');
    }
}

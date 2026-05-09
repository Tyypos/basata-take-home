// EMR admin operations. Dev-only — used by the smoke test to reset state
// between runs. NEVER expose these as agent tools; the LLM should not be
// able to wipe the EMR.

import { http, mapAxiosError } from '../http.js';

// Dev-only — do NOT expose as a tool to the agent.
// Used by the smoke test to reset EMR state between runs.
export async function resetEmr(): Promise<void> {
    try {
        await http.post('/admin/reset');
    } catch (err) {
        throw mapAxiosError(err, 'resetEmr');
    }
}

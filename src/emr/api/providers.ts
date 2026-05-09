// EMR API wrappers for the Providers resource.
// Returns Provider objects including specialties, supported appointment types,
// and free-text scheduling restrictions (which the agent interprets verbatim).

import { http, mapAxiosError } from '../http.js';
import { Provider, ProviderListParams } from '../types.js';

export async function listProviders(
    params: ProviderListParams = {},
): Promise<Provider[]> {
    try {
        const { data } = await http.get<Provider[]>('/providers', { params });
        return data;
    } catch (err) {
        throw mapAxiosError(err, 'listProviders');
    }
}

export async function getProvider(providerId: string): Promise<Provider> {
    try {
        const { data } = await http.get<Provider>(
            `/providers/${encodeURIComponent(providerId)}`,
        );
        return data;
    } catch (err) {
        throw mapAxiosError(err, `getProvider(${providerId})`);
    }
}

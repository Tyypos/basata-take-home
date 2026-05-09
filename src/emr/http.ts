// Shared HTTP transport for the EMR API.
// Owns the axios instance, base URL config, timeout, and error mapping.
// Imported by every file in src/emr/api/. Not part of the public EMR surface —
// consumers outside this directory should use the api/ wrappers, not http directly.

import axios, { AxiosError, AxiosInstance } from 'axios';
import {
    EmrError,
    EmrNotFoundError,
    EmrConflictError,
    EmrValidationFailed,
    EmrUnavailableError,
} from './errors.js';

// ─── Config ────────────────────────────────────────────────────────────────

const EMR_BASE_URL = process.env.EMR_BASE_URL;
if (!EMR_BASE_URL) {
    throw new Error('EMR_BASE_URL is not set in environment');
}

// EMR is a sandbox behind ngrok. 8s timeout — long enough for sandbox latency,
// short enough that callers don't sit in dead air.
const EMR_TIMEOUT_MS = 8000;

export const http: AxiosInstance = axios.create({
    baseURL: EMR_BASE_URL,
    timeout: EMR_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json' },
});

// ─── Error Mapping ─────────────────────────────────────────────────────────

// Translate axios errors into our typed EmrError hierarchy. Tool handlers
// catch these and decide whether to retry, re-prompt, or transfer to a human.
export function mapAxiosError(err: unknown, context: string): EmrError {
    if (!axios.isAxiosError(err)) {
        // Non-axios error (e.g., we threw something ourselves). Wrap and rethrow.
        return new EmrError(
            `${context}: ${(err as Error)?.message ?? 'unknown error'}`,
        );
    }

    const axiosErr = err as AxiosError;
    const status = axiosErr.response?.status;
    const body = axiosErr.response?.data;

    // Network failures, timeouts, DNS — anything before we got a response.
    if (!status) {
        return new EmrUnavailableError(
            `${context}: EMR unreachable (${axiosErr.code ?? 'no code'})`,
            undefined,
            body,
        );
    }

    if (status === 404)
        return new EmrNotFoundError(`${context}: not found`, body);
    if (status === 409)
        return new EmrConflictError(`${context}: conflict`, body);
    if (status === 422)
        return new EmrValidationFailed(`${context}: validation failed`, body);
    if (status >= 500)
        return new EmrUnavailableError(
            `${context}: EMR error ${status}`,
            status,
            body,
        );

    // Other 4xx — generic EMR error.
    return new EmrError(`${context}: HTTP ${status}`, status, body);
}

// Lightweight structured logger. Each webhook request gets a unique requestId
// so we can grep all logs for a single VAPI call across multiple tool invocations.
// Output is JSON — pipes cleanly into any log aggregator without reformatting.

import { randomUUID } from 'node:crypto';

export interface Logger {
    requestId: string;
    info: (msg: string, data?: Record<string, unknown>) => void;
    warn: (msg: string, data?: Record<string, unknown>) => void;
    error: (msg: string, data?: Record<string, unknown>) => void;
}

export function createLogger(requestId: string = randomUUID()): Logger {
    const emit =
        (level: 'info' | 'warn' | 'error') =>
        (msg: string, data?: Record<string, unknown>) => {
            const entry = {
                timestamp: new Date().toISOString(),
                level,
                requestId,
                msg,
                ...data,
            };
            const stream = level === 'error' ? console.error : console.log;
            stream(JSON.stringify(entry));
        };

    return {
        requestId,
        info: emit('info'),
        warn: emit('warn'),
        error: emit('error'),
    };
}

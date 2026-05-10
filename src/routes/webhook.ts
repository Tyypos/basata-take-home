// VAPI webhook entry point.
// Receives POSTs from VAPI when the LLM invokes one or more tools, dispatches
// each call to the right handler, and returns results in VAPI's expected shape.
//
// Non-tool-call messages (call status updates, end-of-call reports) are
// acknowledged but not acted on. Future work could log these for analytics.

import { Router, type Request, type Response } from 'express';
import { dispatchTool } from '../tools/dispatcher.js';
import type { ToolContext } from '../tools/types.js';
import { createLogger } from '../util/logger.js';

export const webhookRouter = Router();

interface VapiToolCall {
    id: string;
    function: {
        name: string;
        arguments: string | Record<string, unknown> | null | undefined;
    };
}

interface VapiMessage {
    type: string;
    toolCallList?: VapiToolCall[];
    call?: {
        id?: string;
        customer?: { number?: string };
    };
}

interface VapiPayload {
    message: VapiMessage;
}

webhookRouter.post('/webhook', async (req: Request, res: Response) => {
    const body = req.body as VapiPayload | undefined;
    const messageType = body?.message?.type;

    // Use VAPI's call ID as our request ID so logs line up across systems.
    const requestId = body?.message?.call?.id;
    const log = createLogger(requestId);

    log.info('webhook received', { messageType });

    // Only handle tool-call messages. Everything else (status-update,
    // end-of-call-report, etc.) gets acknowledged so VAPI stops retrying.
    if (messageType !== 'tool-calls') {
        return res.json({});
    }

    const toolCalls = body?.message?.toolCallList ?? [];
    if (toolCalls.length === 0) {
        log.warn('tool-calls message with empty toolCallList');
        return res.json({ results: [] });
    }

    const ctx: ToolContext = {
        requestId: log.requestId,
        callerPhone: body?.message?.call?.customer?.number,
    };

    // Dispatch all tool calls in parallel. Each handler is independent and
    // doesn't share state, so this is safe and faster than sequential.
    const results = await Promise.all(
        toolCalls.map(async (call) => {
            const toolName = call.function?.name;
            const rawArgs = call.function?.arguments;

            // VAPI sends args as an object (Tools API). Legacy / OpenAI Functions
            // sent them as a JSON-encoded string. Handle both for resilience.
            let parsedArgs: unknown;
            if (rawArgs == null) {
                parsedArgs = {};
            } else if (typeof rawArgs === 'string') {
                try {
                    parsedArgs = JSON.parse(rawArgs);
                } catch (err) {
                    log.error('tool-call: invalid JSON args', {
                        toolCallId: call.id,
                        toolName,
                        rawArgs,
                    });
                    return {
                        toolCallId: call.id,
                        error: 'Tool arguments were not valid JSON.',
                    };
                }
            } else if (typeof rawArgs === 'object') {
                parsedArgs = rawArgs;
            } else {
                log.error('tool-call: unexpected args type', {
                    toolCallId: call.id,
                    toolName,
                    argsType: typeof rawArgs,
                });
                return {
                    toolCallId: call.id,
                    error: 'Tool arguments had an unexpected format.',
                };
            }

            log.info('dispatching tool', {
                toolCallId: call.id,
                toolName,
            });

            try {
                const result = await dispatchTool(toolName, parsedArgs, ctx);

                if (result.ok) {
                    return {
                        toolCallId: call.id,
                        result: JSON.stringify(result.data),
                    };
                }

                return {
                    toolCallId: call.id,
                    error: result.error,
                };
            } catch (err) {
                // Unexpected handler errors (bugs in our code, not EMR errors).
                // Handlers normally return ok:false on EMR failures; this catch
                // is for things we didn't anticipate.
                log.error('tool-call: unhandled handler error', {
                    toolCallId: call.id,
                    toolName,
                    name: (err as Error)?.name,
                    message: (err as Error)?.message,
                });
                return {
                    toolCallId: call.id,
                    error: 'An unexpected error occurred. Please try again or ask to speak with a person.',
                };
            }
        }),
    );

    res.json({ results });
});

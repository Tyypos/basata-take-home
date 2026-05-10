// Shared types for tool handlers.
// Every tool conforms to ToolHandler — takes raw args from the LLM,
// returns a typed result the dispatcher can serialize back to VAPI.

export interface ToolContext {
    // VAPI sends caller metadata with every tool call. We extract what we need
    // (currently just the caller's phone number) and pass it down to handlers
    // so they don't have to dig through the raw VAPI payload.
    callerPhone?: string;
    requestId: string;
}

// Generic tool handler signature. `args` is `unknown` because it comes from
// the LLM as untrusted JSON — each handler validates with Zod before using.
export type ToolHandler = (
    args: unknown,
    ctx: ToolContext,
) => Promise<ToolResult>;

// What a handler returns. Either a successful result (any shape — the LLM
// reads it as JSON) or an error message the LLM will speak to the caller.
export type ToolResult =
    | { ok: true; data: unknown }
    | { ok: false; error: string };

# Basata Take-Home — Voice Agent for Heartland Cardiology

## What this is

A take-home for a Forward Deployed Engineer role at Basata. Inbound voice agent
for a fictional cardiology practice. VAPI handles telephony/STT/LLM/TTS;
my code is the webhook server that VAPI's LLM calls when invoking tools.

## Architecture

- VAPI's LLM calls tools → POSTs to /vapi/webhook → dispatcher routes to handler
  → handler calls EMR client → returns typed result → LLM speaks response.
- EMR is CardioChart Pro (sandbox at https://basata-interview-sandbox-emr.ngrok.app).
- Stack: Node 20, TypeScript (strict, ESM), Express 5, axios, zod, dotenv.

## Folder layout (canonical)

- src/emr/api/ — per-resource HTTP wrappers (patients.ts, providers.ts, slots.ts,
  appointments.ts, admin.ts). Each is a typed wrapper around one EMR resource.
- src/emr/http.ts — shared axios instance + error mapping
- src/emr/types.ts — domain types (Patient, Provider, Slot, Appointment, enums)
- src/emr/errors.ts — EmrError hierarchy (NotFound, Conflict, ValidationFailed,
  Unavailable). All EMR failures map to one of these.
- src/tools/<toolName>/handler.ts — tool runtime implementation
- src/tools/<toolName>/definition.md — VAPI tool config (description, params JSON,
  messages). Copy/pasted into VAPI's dashboard.
- src/tools/dispatcher.ts — name → handler routing
- src/tools/types.ts — ToolHandler contract (ToolContext, ToolResult)
- src/util/logger.ts — structured JSON logger with per-request IDs
- src/routes/webhook.ts — single VAPI webhook endpoint
- src/index.ts — Express entry point
- prompts/ — system prompt and first message as markdown

## Conventions

- TypeScript strict mode on. No `any`. Use `unknown` for untrusted input
  (LLM args), validate via Zod before use.
- ESM imports with `.js` extensions even in source (TS compiles paths unchanged).
- Single quotes, 4-space indent in src files.
- File-level header comment on every file explaining its purpose.
- Each tool handler is annotated `: ToolHandler` (variable type, not function
  return type). The ToolHandler type in src/tools/types.ts specifies the
  contract; handlers conform.
- Error handling: catch `instanceof EmrError` in handlers and return ok:false
  with voice-appropriate messages. Re-throw unexpected errors so the
  dispatcher logs them.
- Logging: `createLogger(ctx.requestId)` per handler invocation. Log
  invocation, EMR call params, EMR result. Never log full PHI; match counts
  and IDs are okay, names and DOBs are not.
- Voice-appropriate error strings: full sentences, no technical jargon,
  always offer transfer when EMR is unavailable.

## Reference implementation

src/tools/lookupPatient/ is the canonical pattern. Match it.

## What's done

- EMR layer (all 8 endpoints typed and wrapped)
- Webhook server with dispatcher
- lookup_patient tool fully wired end-to-end through VAPI

## What's in progress

- 7 remaining tools (register_patient, list_providers, find_available_slots,
  book_appointment, list_patient_appointments, cancel_appointment,
  reschedule_appointment)
- System prompt update
- transferCall VAPI built-in wiring
- Write-up
- Redeploy to Interview Sandbox VAPI org (currently building in personal org)

## Constraints

- No new dependencies. Everything needed is installed (zod, axios, express,
  dotenv on the runtime side; typescript, tsx, @types/\* on dev).
- Don't modify prompts/system-prompt.md — handled separately after tools done.
- Don't modify README.md.
- Don't modify existing tools (lookup_patient) or core infrastructure
  (dispatcher, types, logger, EMR layer) unless asked.
- VAPI tool descriptions cap at 1000 chars. Aim for ~800 to leave headroom.
  Move per-field guidance into parameter property descriptions when needed.

## Anti-patterns to avoid

- console.log outside of the logger
- Sequential awaits in a loop when Promise.all would work (e.g., when
  hydrating provider names for multiple slots)
- Inventing new statuses or arg names; match the spec exactly
- Importing types as values (use `import type { Foo }`)
- Generic error strings — every voice-facing error needs a full sentence
- Mutating the EMR before validating inputs (reschedule especially)

## Specific design decisions documented elsewhere

- Insurance NOT collected over the phone (registration scope decision)
- Provider restrictions passed verbatim to LLM (no parsing in code)
- Slot count hard-capped at 3 in src/emr/api/slots.ts (voice UX guardrail)
- reschedule: book new first, then cancel old (failure modes documented in
  reschedule_appointment definition.md)
- 409 conflict on register_patient checks name+DOB before revealing identity
  (soft PHI guardrail)

## Testing

There's a test runner at `scripts/test-tools.ts` (`npm test`). It:

- Resets the EMR sandbox at the start of every run
- Runs read-only tests in parallel
- Runs mutation tests sequentially with shared state (e.g., a patient registered early is used by later booking tests)

**When you add a new tool, you MUST also add tests to `scripts/test-tools.ts`.**

- For read-only tools (e.g., `list_providers`), add cases to `readOnlyTests`.
- For mutation tools (e.g., `book_appointment`), add a section inside `mutationTests()`. Mutation tests can read and write the shared `state` object — capture IDs you create so downstream tests can use them.

Each tool should have tests covering:

1. The happy path / primary success status
2. At least one alternative status the tool can return (e.g., `not_found`, `slot_taken`, `phone_conflict`)
3. Where applicable, a guardrail check (e.g., PHI-aware response, defensive filter)

Run `npm test` before declaring a tool done. All tests must pass.

## PHI in logs

Never log:

- patient_id, appointment_id
- full names, full phone numbers, email addresses
- date of birth

Use phone suffix (last 4 digits) or hashed values when correlation is needed.
For tracing within a single conversation, the per-request `requestId` is
enough — every log line already includes it.

Acceptable to log:

- enum values (status, appointment_type, specialty)
- counts (matchCount, emrCount, returnedCount)
- non-PHI flags and metadata

Reference: `src/tools/registerPatient/handler.ts` and `src/tools/lookupPatient/handler.ts` for the established pattern.

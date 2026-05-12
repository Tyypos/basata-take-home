**Demo walkthrough:** https://www.loom.com/share/402b2c4d05184ef598b48684e13ae051

# Heartland Cardiology Voice Agent — Write-up

## How I built it

I started with Claude chat as a pair-programming coworker. I made the system
design choices and approved the architecture. After wrapping the EMR API, I
focused on completing one tool first and getting it working fully end-to-end —
that was `lookup_patient`.

Once `lookup_patient` was done and working through VAPI, I moved my workflow
over to Claude Code. The system design was fully in place, so I set up a dev
container and crafted a prompt with Claude (chat) that would have Claude Code
write each remaining tool using my specific system patterns, with me reviewing
each one before moving to the next. I would also cross-reference each
generated tool back with Claude chat. Once a tool was clean (no PHI in logs,
correct response shape, no fabricated args), I'd configure it in VAPI. Claude
Code wrote the remaining 7 tools in this fashion.

## The tools

- `lookup_patient` — find a patient by phone, or by last name + date of birth.
- `register_patient` — create a new patient record (name, DOB, phone — no insurance).
- `list_providers` — list providers, optionally filtered by specialty or appointment type.
- `find_available_slots` — search for open appointment slots, capped at 3, with provider names hydrated.
- `book_appointment` — book a chosen slot.
- `list_patient_appointments` — show a patient's appointments.
- `cancel_appointment` — cancel a specific appointment.
- `reschedule_appointment` — move an existing appointment to a new slot.

## Testing

I added a simple test runner (`npm test`) with at least one test per tool. It
resets the EMR sandbox, runs read-only tests in parallel, then runs mutation
tests sequentially (a registered patient gets used by later booking tests,
which get used by cancel and reschedule). 15+ tests, no test framework — just
plain TypeScript and `fetch`.

## Tool definitions

I kept each tool's VAPI description and parameter schema in a markdown file
right next to the handler (`src/tools/<tool>/definition.md`). The markdown
isn't referenced in code — it's the source-of-truth for what gets pasted into
VAPI's dashboard. Easier to maintain than embedding it in TypeScript, since
it's content for VAPI's LLM, not code for my server.

## Iteration

Once all 8 tools were configured in VAPI, I tested and tweaked things — mostly
the system prompt — until each major flow worked end-to-end: identification,
registration, booking, cancellation, rescheduling, provider restrictions, and
transfer.

## Running the project

1. `npm install` to install dependencies
2. `npm run dev` to start the webhook server on port 3000
3. `ngrok http 3000` (in a separate terminal) to expose it publicly
4. Configure VAPI tools with the ngrok URL + `/vapi/webhook`
5. `npm test` to verify the tools work against the EMR sandbox

The project also includes a dev container (`.devcontainer/`) so it can be run
in a consistent environment.

## Stack

Node 20, TypeScript (strict, ESM), Express 5, axios, zod, dotenv. No frontend.
The webhook server is the only piece of code I had to write — VAPI handles
telephony, STT, LLM, and TTS; my code receives tool calls, talks to the EMR,
and returns results.

## Things I explicitly decided on

**Insurance not collected over the phone.** Member IDs are 10–15 character
alphanumeric strings — brutal over voice, and most real practices capture them
at intake. The agent registers the minimum required fields and flags insurance
for in-person check-in.

**Reschedule is server-orchestrated.** There's no EMR "reschedule" endpoint, so
my tool does it in one composite call: validate the original → book the new
slot → cancel the old. Book-then-cancel ordering means if the new booking fails,
the caller still has their original appointment. If the cancel fails after the
book succeeds, the tool retries once, then returns a distinct
`manual_intervention_required` status with both appointment IDs so a human
can reconcile.

**PHI-aware conflict handling on registration.** If a caller tries to register
and the phone number is already on file, the tool checks whether the name and
DOB match the existing record. If they match → `already_registered`. If they
don't → `phone_conflict` with no patient details returned. The agent doesn't
reveal whose phone it is.

**Provider restrictions interpreted by the LLM.** Each provider has a
`restrictions` field with free-text English (e.g., "Available Monday,
Wednesday, and Friday only"). I considered parsing these in code but chose to
pass them verbatim to the LLM and teach the system prompt how to interpret
each restriction type. For deterministic constraints (provider/appointment-type
compatibility), the handler does the filtering directly as defense-in-depth.

**Voice UX limits enforced in code, not just in the prompt.** The slot search
hard-caps at 3 results — a prompt rule alone would be unreliable. The cap
lives in `src/emr/api/slots.ts`.

**Verbal confirmation required before every mutation.** Book, cancel,
reschedule, and register each have a "confirm verbally before invoking"
instruction in the system prompt. For reschedule, both the cancellation and
the new booking must be confirmed in one sentence.

## With more time

- A `sync-vapi.ts` script that pushes tool definitions from the repo to VAPI's
  API. Configuring 8 tools manually in the dashboard was error-prone — I
  caught 7 wrong Server URLs during end-to-end testing because manual paste
  is fragile.
- Patient-context propagation through the conversation so `reschedule_appointment`
  could verify cross-patient access (currently it can't, since it derives
  patient_id from the original appointment rather than from a verified
  context).
- Real age-restriction enforcement for Dr. Patel (currently the LLM interprets
  the restriction text and asks for the patient's age — works but requires
  the LLM to remember to ask).
- Phone-format normalization (currently relies on the LLM passing E.164).
- A `Dr.` prefix that's only applied to MDs (currently every provider gets
  `Dr.`, even Jamie Williams, PA-C).

## AI tooling disclosure

I used Claude as a pair-programming partner for the initial architecture,
design decisions, and the `lookup_patient` implementation. The remaining 7
tools were generated by Claude Code against a spec I wrote based on those
earlier decisions. I reviewed each tool individually before committing,
confirmed it matched intent (especially around PHI in logs and response
shape), and tested each against the EMR sandbox.

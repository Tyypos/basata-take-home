# basata-take-home - Heartland Cardiology Voice Agent

Inbound voice AI agent for a fictional cardiology practice. Patients call in, talk to the agent, and walk away with an appointment booked, looked up, cancelled, or rescheduled. Built for Basata's Forward Deployed Engineer take-home.

**For project context, design decisions, and reasoning, see [WRITEUP.md](./WRITEUP.md).**

## What this is

This repo contains the webhook server that backs a VAPI voice agent. VAPI handles telephony, STT, LLM, and TTS; this server receives tool calls from VAPI's LLM and talks to the CardioChart Pro EMR sandbox to look up, create, update, and cancel patient records and appointments.

The VAPI assistant is configured in the Interview Sandbox org. Tool definitions, system prompt, and first message live in this repo and are pasted into VAPI's dashboard (see "VAPI configuration" below).

## Architecture at a glance

    Caller → VAPI (phone / web call)
           → STT → LLM (GPT-5-mini) → TTS
           → Tool call → THIS SERVER (Express)
           → CardioChart Pro EMR (sandbox)
           → Result back to LLM → response to caller

The webhook server is the only piece of code in this repo. VAPI is configured in its dashboard.

## Stack

Node 20, TypeScript (strict, ESM), Express 5, axios, zod, dotenv. No frontend.

## Running the server

The repo includes a dev container (`.devcontainer/`) so this should run consistently in VS Code "Reopen in Container" or via the Dev Containers CLI. The instructions below assume you're inside the container, but they work on any host with Node 20.

### 1. Install

```
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env`:

```
cp .env.example .env
```

Edit `.env` and set `EMR_BASE_URL` to the CardioChart Pro sandbox URL from the take-home brief.

### 3. Run the server

```
npm run dev
```

The webhook server listens on port 3000. Confirm with:

```
curl http://localhost:3000/health
```

Should return `{"status":"ok"}`.

### 4. Expose it publicly with ngrok

VAPI's LLM POSTs tool calls to a public URL. Use ngrok (or any tunnel) to expose your local server:

```
ngrok http 3000
```

Note the forwarding URL (e.g., `https://abc-123.ngrok-free.dev`). VAPI will need this URL plus the path `/vapi/webhook`.

## VAPI configuration

The VAPI assistant is already configured in the Interview Sandbox org with my ngrok URL. **For Basata to test it directly, the assistant link in the submission is the easiest entry point.**

If you want to point the assistant at your own server instead:

1. Open the assistant in the VAPI dashboard.
2. For each of the 8 tools, update **Server URL** to `<your-public-url>/vapi/webhook`.
3. Re-publish the assistant.

The 8 tool definitions live in `src/tools/<tool>/definition.md`. Each `.md` file contains the description, parameters JSON, server settings, and messages to paste into VAPI's dashboard.

The system prompt is in `prompts/system-prompt.md`. The first message is in `prompts/first-message.md`.

## Running the test suite

```
npm test
```

Resets the EMR sandbox, runs read-only tests in parallel, then runs mutation tests (register → find slots → book → list → cancel → reschedule) sequentially with shared state. 15+ tests covering happy paths and key edge cases.

Run while `npm run dev` is also running — the test runner calls the local webhook server, not the EMR directly.

## Other useful scripts

```
npm run reset    # Reset EMR state without running tests
npm run build    # TypeScript build
```

## Repo layout

    .
    ├── prompts/                        # System prompt + first message (pasted into VAPI)
    ├── scripts/
    │   ├── reset.ts                    # Reset EMR sandbox
    │   └── test-tools.ts               # Test runner
    ├── src/
    │   ├── emr/                        # Typed wrapper around the CardioChart Pro EMR
    │   │   ├── api/                    # Per-resource HTTP wrappers (patients, providers, slots, appointments)
    │   │   ├── errors.ts               # EmrError hierarchy (NotFound, Conflict, Unavailable, etc.)
    │   │   ├── http.ts                 # Shared axios instance + error mapping
    │   │   └── types.ts                # Domain types
    │   ├── tools/
    │   │   ├── <toolName>/
    │   │   │   ├── handler.ts          # Tool runtime
    │   │   │   └── definition.md       # VAPI dashboard config (description, params, messages)
    │   │   ├── dispatcher.ts           # Routes tool calls by name to handlers
    │   │   └── types.ts                # ToolHandler contract
    │   ├── routes/webhook.ts           # POST /vapi/webhook entry point
    │   ├── util/logger.ts              # Structured JSON logger with per-request IDs
    │   └── index.ts                    # Express entry
    ├── .devcontainer/                  # VS Code dev container
    ├── CLAUDE.md                       # Memory file for AI-assisted development
    ├── WRITEUP.md                      # Project context and design decisions
    └── README.md

## Tools

| Tool                        | Purpose                                                               |
| --------------------------- | --------------------------------------------------------------------- |
| `lookup_patient`            | Find a patient by phone, or by last name + DOB.                       |
| `register_patient`          | Create a new patient record (name, DOB, phone).                       |
| `list_providers`            | List providers, optionally filtered by specialty or appointment type. |
| `find_available_slots`      | Search for open slots (capped at 3) with provider names hydrated.     |
| `book_appointment`          | Book a chosen slot.                                                   |
| `list_patient_appointments` | Show a patient's appointments.                                        |
| `cancel_appointment`        | Cancel an appointment.                                                |
| `reschedule_appointment`    | Move an appointment to a new slot (server-side composite).            |

Plus `transferCall` (VAPI built-in) for handing off to a human.

## On running this yourself

The submission's VAPI assistant is configured with my ngrok URL, so the easiest way to test the agent is via the assistant link itself — Basata's review can web-call it from the dashboard or dial the provisioned phone number.

If you want to clone, run the server yourself, and point a VAPI assistant at it, the steps above will get you there. You'd need to update each tool's Server URL in your VAPI dashboard to your tunnel.

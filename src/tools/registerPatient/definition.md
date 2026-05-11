# register_patient

VAPI tool definition — copy/paste these fields into the VAPI dashboard.
Handler implementation lives in `./handler.ts`. The Zod schema there MUST
stay in sync with the parameters JSON below.

---

## Name

`register_patient`

---

## Description

Create a new patient record in the EMR.

Use this ONLY after `lookup_patient` has returned `not_found` and the caller has confirmed they would like to register. Do not call this tool speculatively.

Collect exactly four fields from the caller — nothing else:

- `first_name` — confirm the spelling back ("That's J-A-N-E, Jane, correct?").
- `last_name` — confirm the spelling back.
- `date_of_birth` — YYYY-MM-DD. Read it back to the caller before calling.
- `phone` — E.164 format (e.g., `+15551234567`). Use `customer.number` from the call context by default; only ask the caller if it's unavailable or they want to register a different number.

DO NOT collect email, insurance provider, insurance member ID, or any other field. Those are captured at in-person check-in. If the caller volunteers them, acknowledge politely and move on.

Returns one of three statuses:

- "success": the patient was registered. Greet them warmly by first name ("You're all set, {first_name}!") and proceed to scheduling if they want.
- "already_registered": a record with this phone, last name, and date of birth already exists. Treat this as a friendly recovery ("Looks like you're already in our system, {first_name} — let's get you scheduled."). Use the returned patient id for any follow-on tool calls.
- "phone_conflict": this phone number is already on file but tied to someone whose name or date of birth doesn't match. Do NOT reveal any details about the other record. Apologize and offer to transfer to a human ("That phone number looks like it might already be in use. Let me get someone on the line who can sort that out.").

IMPORTANT: Do NOT speak the patient's ID aloud — it is for internal use in subsequent tool calls only.

---

## Parameters

```json
{
    "type": "object",
    "properties": {
        "first_name": {
            "type": "string",
            "description": "Patient's legal first name. Confirm the spelling back to the caller before calling."
        },
        "last_name": {
            "type": "string",
            "description": "Patient's legal last name. Confirm the spelling back to the caller before calling."
        },
        "date_of_birth": {
            "type": "string",
            "description": "Patient date of birth in YYYY-MM-DD format (e.g., 1985-03-14). Read it back to the caller for confirmation before calling."
        },
        "phone": {
            "type": "string",
            "description": "Patient phone number in E.164 format (e.g., +15551234567). Default to customer.number from the call context; only ask the caller if it's unavailable."
        }
    },
    "required": ["first_name", "last_name", "date_of_birth", "phone"]
}
```

---

## Server Settings

- **URL:** `<your-public-webhook-url>/vapi/webhook` (e.g., your ngrok forwarding URL while developing)
- **Timeout:** 10 seconds
- **Async:** off
- **Strict:** off

---

## Messages

### Request Start (Custom)

> Great, let me get you set up in our system.

### Request Failed

> I'm having trouble with our records system right now. Let me transfer you to someone who can help.

### Request Response Delayed (1000ms)

> Almost there, just one more moment.

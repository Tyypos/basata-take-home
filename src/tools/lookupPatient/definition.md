# lookup_patient

VAPI tool definition — copy/paste these fields into the VAPI dashboard.
Handler implementation lives in `./handler.ts`. The Zod schema there MUST
stay in sync with the parameters JSON below.

---

## Name

`lookup_patient`

---

## Description

Find an existing patient record in the EMR.
Use this at the START of every call to identify the caller before doing anything else.
First, try the caller's phone number (available from customer.number in the call context).
If the result is "not_found", ask the caller for their last name and date of birth, then call this tool again with both fields.

Returns one of three statuses:

- "found": single match. Greet the caller by first name and proceed.
- "not_found": no match. Offer to register them as a new patient using register_patient.
- "ambiguous": multiple matches (rare). Ask a clarifying question (e.g., first name) and call again with all three fields.

IMPORTANT: Do NOT speak the patient's ID aloud — it is for internal use in subsequent tool calls only.

---

## Parameters

```json
{
    "type": "object",
    "properties": {
        "phone": {
            "type": "string",
            "description": "Patient phone number in E.164 format (e.g., +15551234567). Pass customer.number from the call context on the first lookup attempt."
        },
        "last_name": {
            "type": "string",
            "description": "Patient last name. Use as a fallback when phone lookup returns 'not_found'. Must be provided together with date_of_birth. Case-insensitive."
        },
        "date_of_birth": {
            "type": "string",
            "description": "Patient date of birth in YYYY-MM-DD format (e.g., 1985-03-14). Required when last_name is provided."
        }
    }
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

> One moment while I look that up.

### Request Failed

> I'm having trouble with our records system right now. Let me transfer you to someone who can help.

### Request Response Delayed (1000ms)

> Still working on that, just a moment.

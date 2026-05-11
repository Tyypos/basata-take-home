# lookup_patient

VAPI tool definition — copy/paste these fields into the VAPI dashboard.
Handler implementation lives in `./handler.ts`. The Zod schema there MUST
stay in sync with the parameters JSON below.

---

## Name

`lookup_patient`

---

## Description

Find an existing patient record in the EMR. Use this at the START of every call to identify the caller before doing anything else.

First, try the caller's phone number (from customer.number in the call context). If customer.number is missing or not present, do NOT invent a phone value AND do NOT call this tool with empty args — first ask the caller for their last name and date of birth, then call this tool with both of those fields together.

If a phone lookup returns "not_found", ask the caller for their last name and date of birth, then call again with both fields.

Returns:

- "found": single match. Greet by first name and proceed.
- "not_found": no match. Offer register_patient.
- "ambiguous": multiple matches. Ask for first name and call again with all three.

IMPORTANT: Do NOT speak the patient's ID aloud — internal use only.

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

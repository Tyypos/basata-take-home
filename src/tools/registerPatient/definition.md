# register_patient

VAPI tool definition — copy/paste these fields into the VAPI dashboard.
Handler implementation lives in `./handler.ts`. The Zod schema there MUST
stay in sync with the parameters JSON below.

---

## Name

`register_patient`

---

## Description

Create a new patient record in the EMR. Use ONLY after lookup_patient returned "not_found" and the caller confirmed they want to register. Do not call speculatively.

Collect exactly four fields: first_name, last_name, date_of_birth (YYYY-MM-DD), and phone (E.164). Do NOT collect email, insurance, or any other field — those are captured at in-person check-in.

Returns one of three statuses:

- "success": new patient created. Greet by first name and proceed.
- "already_registered": phone + name + DOB matched an existing record. Use the returned id for follow-on calls. Recover gracefully ("Looks like you're already in our system").
- "phone_conflict": phone exists but name/DOB don't match. Do NOT reveal any other record's details. Apologize and offer to transfer.

IMPORTANT: Do NOT speak the patient's ID aloud — internal use only.

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

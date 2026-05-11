# cancel_appointment

VAPI tool definition — copy/paste these fields into the VAPI dashboard.
Handler implementation lives in `./handler.ts`. The Zod schema there MUST
stay in sync with the parameters JSON below.

---

## Name

`cancel_appointment`

---

## Description

Cancel a specific appointment. Use ONLY after verbally confirming the details with the caller ("Just to confirm, you want to cancel your Tuesday 10 AM appointment with Dr. Martinez?").

Pass `appointment_id` from a recent list_patient_appointments result. Do NOT let the caller dictate an id; do NOT invent one.

Returns one of three statuses:

- "success": cancelled. Confirm naturally ("Done, your Tuesday 10 AM with Dr. Martinez is cancelled."). The response includes provider_name and start_time for the readback.
- "not_found": no appointment with that id. Offer to run list_patient_appointments again.
- "already_cancelled": it was already cancelled. Clarify gracefully ("It looks like that one was already cancelled — anything else I can help with?"). The response includes provider_name and start_time.

IMPORTANT: Do NOT speak the appointment id or provider id aloud.

---

## Parameters

```json
{
    "type": "object",
    "properties": {
        "appointment_id": {
            "type": "string",
            "description": "Internal appointment id from a prior list_patient_appointments result. Never spoken to or by the caller."
        }
    },
    "required": ["appointment_id"]
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

> Cancelling that for you now.

### Request Failed

> I'm having trouble cancelling that right now. Let me transfer you to someone who can help.

### Request Response Delayed (1000ms)

> Almost done, one more moment.

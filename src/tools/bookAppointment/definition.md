# book_appointment

VAPI tool definition — copy/paste these fields into the VAPI dashboard.
Handler implementation lives in `./handler.ts`. The Zod schema there MUST
stay in sync with the parameters JSON below.

---

## Name

`book_appointment`

---

## Description

Book the slot the caller picked. Use ONLY after find_available_slots returned a slot the caller chose AND you've verbally confirmed it ("Tuesday at 10 AM with Dr. Martinez, sound good?").

Pass `start_time`, `provider_id`, and `appointment_type` verbatim from the chosen slot — do NOT invent timestamps or change the appointment_type (duration is aligned to type).

`reason` is optional; pass it only if the caller volunteered one.

Returns one of two statuses:

- "success": appointment booked. Confirm naturally. The appointment.id is for follow-on cancel/reschedule — keep it internal.
- "slot_taken": someone else grabbed the slot between search and book. Apologize and re-run find_available_slots to offer another option.

IMPORTANT: Do NOT speak the appointment id or provider id aloud.

---

## Parameters

```json
{
    "type": "object",
    "properties": {
        "patient_id": {
            "type": "string",
            "description": "Internal patient id from a prior lookup_patient or register_patient call."
        },
        "provider_id": {
            "type": "string",
            "description": "Provider id from the chosen slot in the most recent find_available_slots result. Do not substitute."
        },
        "start_time": {
            "type": "string",
            "description": "ISO 8601 start_time from the chosen slot. Pass verbatim — do not reformat or re-derive from the spoken time."
        },
        "appointment_type": {
            "type": "string",
            "enum": [
                "new_patient",
                "follow_up",
                "procedure_consult",
                "stress_test",
                "telehealth"
            ],
            "description": "Must match the appointment_type used in the slot search. Determines duration."
        },
        "reason": {
            "type": "string",
            "description": "Optional free-text reason for the visit. Pass only if the caller volunteered it; do not prompt for it."
        }
    },
    "required": ["patient_id", "provider_id", "start_time", "appointment_type"]
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

> Booking that for you now.

### Request Failed

> I'm having trouble booking that right now. Let me transfer you to someone who can help.

### Request Response Delayed (1000ms)

> Almost done, one more moment.

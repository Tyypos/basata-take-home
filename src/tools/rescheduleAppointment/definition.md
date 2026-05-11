# reschedule_appointment

VAPI tool definition — copy/paste these fields into the VAPI dashboard.
Handler implementation lives in `./handler.ts`. The Zod schema there MUST
stay in sync with the parameters JSON below.

This is a server-orchestrated composite (validate → book new → cancel old)
with explicit failure modes. The handler header comment lists every status
and the conditions that produce each.

---

## Name

`reschedule_appointment`

---

## Description

Move an existing appointment to a new slot. Use ONLY when the caller asks to reschedule, after verbally confirming both the cancel and the new booking. patient_id is derived server-side.

`appointment_id` from list_patient_appointments. `new_start_time`, `new_provider_id`, `appointment_type` from a find_available_slots result.

Statuses:

- "success": rescheduled. Read back new_appointment.provider_name and start_time.
- "slot_taken": race lost; original intact. Re-run find_available_slots.
- "original_not_found": no such id. Offer to list appointments.
- "original_not_scheduled": already cancelled/completed; offer to book fresh.
- "manual_intervention_required": new IS booked but cancel of old failed. Say "Your new appointment is set for {time} with {provider_name}, but I had trouble removing the old one. Let me get a person on the line." Then transfer.
- "failed": apologize and transfer.

Do NOT speak ids aloud.

---

## Parameters

```json
{
    "type": "object",
    "properties": {
        "appointment_id": {
            "type": "string",
            "description": "Internal id of the appointment to reschedule, from a prior list_patient_appointments result."
        },
        "new_start_time": {
            "type": "string",
            "description": "ISO 8601 start_time from a recent find_available_slots result. Pass verbatim — do not reformat."
        },
        "new_provider_id": {
            "type": "string",
            "description": "Provider id from the chosen slot in the most recent find_available_slots result."
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
            "description": "Type of the new appointment. Must match the appointment_type used in the slot search."
        },
        "reason": {
            "type": "string",
            "description": "Optional. Pass only if the caller volunteered a reason."
        }
    },
    "required": [
        "appointment_id",
        "new_start_time",
        "new_provider_id",
        "appointment_type"
    ]
}
```

---

## Server Settings

- **URL:** `<your-public-webhook-url>/vapi/webhook` (e.g., your ngrok forwarding URL while developing)
- **Timeout:** 15 seconds
- **Async:** off
- **Strict:** off

Note: timeout is bumped to 15s because this tool makes up to four EMR
calls in sequence (fetch + book + cancel + possibly retry-cancel +
provider hydration).

---

## Messages

### Request Start (Custom)

> Let me move that for you.

### Request Failed

> I'm having trouble rescheduling that right now. Let me transfer you to someone who can help.

### Request Response Delayed (1000ms)

> Still working on it, just a moment.

---

## Known gap

Cross-patient access protection is NOT enforced inside this tool. Since `reschedule_appointment` doesn't take `patient_id`, we cannot verify that the caller owns the appointment they're rescheduling. In production this would be carried in the conversation context (verified `patient_id` from lookup_patient) and checked against `original.patient_id` here. The mitigation in this implementation is that lookup_patient runs at the start of every call.

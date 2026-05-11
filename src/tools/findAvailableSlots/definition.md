# find_available_slots

VAPI tool definition — copy/paste these fields into the VAPI dashboard.
Handler implementation lives in `./handler.ts`. The Zod schema there MUST
stay in sync with the parameters JSON below.

---

## Name

`find_available_slots`

---

## Description

Search the EMR for open appointment slots, hydrated with provider names. Use once you have a patient_id (from lookup_patient or register_patient) AND a decided appointment_type. First-time callers are always `new_patient`; if unsure, ask.

Map caller phrases to filters: "mornings only" → end_time_of_day=12:00; "after work" → start_time_of_day=17:00; "soonest" → earliest_available=true; "only Dr. X" → provider_id from a prior list_providers result.

Returns one of two statuses:

- "success": 1-3 slots. Read at most 2-3 aloud. Each slot includes provider_id and start_time — pass those verbatim into book_appointment.
- "no_slots": nothing matched. `searched_with` echoes the filters used; offer to widen one (date range, drop provider, different time of day).

IMPORTANT: Do NOT speak provider IDs aloud. Do NOT list more than 3 slots.

---

## Parameters

```json
{
    "type": "object",
    "properties": {
        "patient_id": {
            "type": "string",
            "description": "Internal patient id from a prior lookup_patient or register_patient call. Required by the EMR."
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
            "description": "Type of visit. First-time callers are always new_patient. Determines duration and provider eligibility; must match the type used later in book_appointment."
        },
        "provider_id": {
            "type": "string",
            "description": "Restrict to one provider. Use only when the caller named a specific provider — pass the id from a prior list_providers result."
        },
        "start_date": {
            "type": "string",
            "description": "Earliest date to consider, YYYY-MM-DD. Defaults to today server-side. Use for 'next week', 'after the 15th', etc."
        },
        "end_date": {
            "type": "string",
            "description": "Latest date to consider, YYYY-MM-DD. Defaults to start_date + 14 days server-side."
        },
        "start_time_of_day": {
            "type": "string",
            "description": "Earliest time of day, HH:MM 24-hour. 'After work' ≈ 17:00, 'afternoons' ≈ 12:00."
        },
        "end_time_of_day": {
            "type": "string",
            "description": "Latest time of day, HH:MM 24-hour. 'Mornings only' ≈ 12:00."
        },
        "days_of_week": {
            "type": "string",
            "description": "Comma-separated upper-case day codes, e.g. 'MON,WED,FRI'. Use for 'weekdays only', 'Tuesdays and Thursdays'."
        },
        "earliest_available": {
            "type": "boolean",
            "description": "Set true when the caller wants the soonest possible slot ('whenever you have', 'as soon as possible')."
        }
    },
    "required": ["patient_id", "appointment_type"]
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

> Let me check what we have open.

### Request Failed

> I'm having trouble checking our schedule right now. Let me transfer you to someone who can help.

### Request Response Delayed (1000ms)

> Still looking, just a moment.

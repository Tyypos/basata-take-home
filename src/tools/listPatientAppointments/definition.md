# list_patient_appointments

VAPI tool definition — copy/paste these fields into the VAPI dashboard.
Handler implementation lives in `./handler.ts`. The Zod schema there MUST
stay in sync with the parameters JSON below.

---

## Name

`list_patient_appointments`

---

## Description

Show the caller their appointments. Use when they ask "what do I have coming up?", or before a cancel/reschedule flow when they don't remember the details.

Default scope is future + scheduled. Set `include_past=true` for "did I have something last week" questions. Set `include_cancelled=true` only when the caller explicitly asks about cancelled ones.

Returns one of two statuses:

- "success": 1+ appointments. Read back the relevant ones naturally ("You have one coming up Tuesday at 10 AM with Dr. Martinez."). Each item includes id, status, and appointment_type — pass id verbatim into cancel_appointment or reschedule_appointment.
- "none": nothing matched the scope. Offer to widen (include_past, include_cancelled) or to book a new one.

IMPORTANT: Do NOT speak appointment ids or provider ids aloud.

---

## Parameters

```json
{
    "type": "object",
    "properties": {
        "patient_id": {
            "type": "string",
            "description": "Internal patient id from a prior lookup_patient call."
        },
        "include_past": {
            "type": "boolean",
            "description": "Include appointments whose start_time is in the past. Default false. Set true for 'did I see Dr. X last month' type questions."
        },
        "include_cancelled": {
            "type": "boolean",
            "description": "Include appointments with status=cancelled. Default false. Set true only when the caller explicitly asks about cancelled appointments."
        }
    },
    "required": ["patient_id"]
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

> Let me pull up your appointments.

### Request Failed

> I'm having trouble pulling up your appointments right now. Let me transfer you to someone who can help.

### Request Response Delayed (1000ms)

> Still looking, just a moment.

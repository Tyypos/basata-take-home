# list_providers

VAPI tool definition — copy/paste these fields into the VAPI dashboard.
Handler implementation lives in `./handler.ts`. The Zod schema there MUST
stay in sync with the parameters JSON below.

---

## Name

`list_providers`

---

## Description

List cardiology providers, optionally filtered by specialty and/or appointment_type. Use when the caller wants to know who's available, names a specific provider, or before scheduling so you have real provider IDs to feed into find_available_slots and book_appointment.

Each returned provider has a `restrictions` field — free-text English (e.g., "Available Monday, Wednesday, and Friday only."). Read these and honor them when proposing slots; do not propose times that violate them.

Returns one of two statuses:

- "success": one or more providers matched. Use the array verbatim — it's in the EMR's preferred order.
- "no_providers": filter was too narrow. Offer to broaden (drop a filter, try a different specialty).

IMPORTANT: Do NOT speak provider IDs aloud — internal use only. Do NOT recite full specialty lists or every provider unless the caller asks; pick the relevant one or two.

---

## Parameters

```json
{
    "type": "object",
    "properties": {
        "specialty": {
            "type": "string",
            "enum": [
                "general_cardiology",
                "interventional_cardiology",
                "electrophysiology"
            ],
            "description": "Filter to providers practicing this specialty. Pass only if the caller mentions one (e.g., 'I need an electrophysiologist'); otherwise omit and show all."
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
            "description": "Filter to providers who support this appointment type. Pass when you already know the visit type so the caller doesn't hear about providers who can't help them."
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

> Let me check who we have available.

### Request Failed

> I'm having trouble pulling up our provider list right now. Let me transfer you to someone who can help.

### Request Response Delayed (1000ms)

> Still pulling that up, just a moment.

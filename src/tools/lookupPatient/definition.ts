// VAPI tool definition for lookup_patient.
// Configured in the VAPI assistant; the LLM reads the description and
// parameter docs to decide when to call the tool and how to fill its args.
//
// This file is the prompt-engineering surface for tool selection. The handler
// (./handler.ts) is the runtime implementation. They MUST stay in sync —
// if you change the schema here, update the Zod schema in handler.ts too.

export const lookupPatientDefinition = {
    type: 'function',
    function: {
        name: 'lookup_patient',
        description: [
            'Find an existing patient record in the EMR.',
            'Use this at the START of every call to identify the caller before doing anything else.',
            "First, try the caller's phone number (available from customer.number in the call context).",
            'If the result is "not_found", ask the caller for their last name and date of birth, then call this tool again with both fields.',
            'Returns one of three statuses:',
            '- "found": single match. Greet the caller by first name and proceed.',
            '- "not_found": no match. Offer to register them as a new patient using register_patient.',
            '- "ambiguous": multiple matches (rare). Ask a clarifying question (e.g., first name) and call again with all three fields.',
            "IMPORTANT: Do NOT speak the patient's ID aloud — it is for internal use in subsequent tool calls only.",
        ].join(' '),
        parameters: {
            type: 'object',
            properties: {
                phone: {
                    type: 'string',
                    description:
                        'Patient phone number in E.164 format (e.g., +15551234567). Pass customer.number from the call context on the first lookup attempt.',
                },
                last_name: {
                    type: 'string',
                    description:
                        'Patient last name. Use as a fallback when phone lookup returns "not_found". Must be provided together with date_of_birth. Case-insensitive.',
                },
                date_of_birth: {
                    type: 'string',
                    description:
                        'Patient date of birth in YYYY-MM-DD format (e.g., 1985-03-14). Required when last_name is provided.',
                },
            },
        },
    },
} as const;

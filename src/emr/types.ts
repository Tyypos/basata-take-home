// EMR API response and request types — derived from CardioChart Pro Swagger schemas.
// These mirror the shapes returned by the EMR; we don't transform them.

export type Specialty =
    | 'general_cardiology'
    | 'interventional_cardiology'
    | 'electrophysiology';

export type AppointmentType =
    | 'new_patient'
    | 'follow_up'
    | 'procedure_consult'
    | 'stress_test'
    | 'telehealth';

export type AppointmentStatus =
    | 'scheduled'
    | 'cancelled'
    | 'completed'
    | 'no_show';

// ─── Patients ──────────────────────────────────────────────────────────────

export interface Patient {
    id: string;
    first_name: string;
    last_name: string;
    date_of_birth: string; // YYYY-MM-DD
    phone: string; // E.164, e.g. +15551234567
    email: string | null;
    insurance_provider: string | null;
    insurance_member_id: string | null;
}

export interface PatientCreate {
    first_name: string;
    last_name: string;
    date_of_birth: string; // YYYY-MM-DD
    phone: string; // E.164
    email?: string | null;
    insurance_provider?: string | null;
    insurance_member_id?: string | null;
}

export interface PatientSearchParams {
    phone?: string;
    last_name?: string;
    date_of_birth?: string; // YYYY-MM-DD
}

// ─── Providers ─────────────────────────────────────────────────────────────

export interface Provider {
    id: string;
    first_name: string;
    last_name: string;
    title: string; // e.g. 'MD', 'PA-C'
    specialties: Specialty[];
    supported_appointment_types: AppointmentType[];
    restrictions: string | null; // free-text scheduling rules — pass to LLM verbatim
    bio: string;
}

export interface ProviderListParams {
    specialty?: Specialty;
}

// ─── Slots ─────────────────────────────────────────────────────────────────

export interface Slot {
    provider_id: string;
    start_time: string; // ISO 8601
    end_time: string; // ISO 8601
    supported_appointment_types: AppointmentType[];
    is_telehealth: boolean;
}

export interface SlotSearchParams {
    patient_id: string; // required by EMR
    appointment_type: AppointmentType; // required — sets duration
    start_date?: string; // YYYY-MM-DD; defaults to today
    end_date?: string; // YYYY-MM-DD; defaults to start_date + 14
    start_time_of_day?: string; // HH:MM
    end_time_of_day?: string; // HH:MM
    days_of_week?: string; // 'MON,TUE,WED'
    earliest_available?: boolean;
    provider_id?: string;
    number_of_slots_to_present?: number;
}

// ─── Appointments ──────────────────────────────────────────────────────────

export interface Appointment {
    id: string;
    patient_id: string;
    provider_id: string;
    start_time: string; // ISO 8601
    end_time: string; // ISO 8601
    appointment_type: AppointmentType;
    status: AppointmentStatus;
    reason: string | null;
    notes: string | null;
    is_telehealth: boolean;
    created_at: string; // ISO 8601
}

export interface AppointmentCreate {
    patient_id: string;
    provider_id: string;
    start_time: string; // ISO 8601 — must match a slot's start_time
    appointment_type: AppointmentType;
    reason?: string | null;
}

export interface AppointmentListParams {
    patient_id?: string;
    include_cancelled?: boolean; // default false
}

// ─── EMR Error Response ────────────────────────────────────────────────────

// 422 validation error from FastAPI
export interface EmrValidationError {
    detail: Array<{
        loc: (string | number)[];
        msg: string;
        type: string;
        input?: unknown;
        ctx?: Record<string, unknown>;
    }>;
}

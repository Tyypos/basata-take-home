// EMR API wrappers for the Patients resource.
// Covers patient lookup (by phone or last_name + DOB), retrieval by ID,
// and registration. Returns typed Patient objects from src/emr/types.ts.

import { http, mapAxiosError } from '../http.js';
import { Patient, PatientCreate, PatientSearchParams } from '../types.js';

export async function searchPatients(
    params: PatientSearchParams,
): Promise<Patient[]> {
    try {
        const { data } = await http.get<Patient[]>('/patients', { params });
        return data;
    } catch (err) {
        throw mapAxiosError(err, 'searchPatients');
    }
}

export async function getPatient(patientId: string): Promise<Patient> {
    try {
        const { data } = await http.get<Patient>(
            `/patients/${encodeURIComponent(patientId)}`,
        );
        return data;
    } catch (err) {
        throw mapAxiosError(err, `getPatient(${patientId})`);
    }
}

export async function createPatient(patient: PatientCreate): Promise<Patient> {
    try {
        const { data } = await http.post<Patient>('/patients', patient);
        return data;
    } catch (err) {
        throw mapAxiosError(err, 'createPatient');
    }
}

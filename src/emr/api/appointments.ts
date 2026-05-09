// EMR API wrappers for the Appointments resource.
// Covers listing (filtered by patient), retrieval by ID, booking, and cancellation.
// Note: there is no reschedule endpoint — reschedule is composed at the tool
// layer as book-new-then-cancel-old, ordered to fail safely.

import { http, mapAxiosError } from '../http.js';
import {
    Appointment,
    AppointmentCreate,
    AppointmentListParams,
} from '../types.js';

export async function listAppointments(
    params: AppointmentListParams = {},
): Promise<Appointment[]> {
    try {
        const { data } = await http.get<Appointment[]>('/appointments', {
            params,
        });
        return data;
    } catch (err) {
        throw mapAxiosError(err, 'listAppointments');
    }
}

export async function getAppointment(
    appointmentId: string,
): Promise<Appointment> {
    try {
        const { data } = await http.get<Appointment>(
            `/appointments/${encodeURIComponent(appointmentId)}`,
        );
        return data;
    } catch (err) {
        throw mapAxiosError(err, `getAppointment(${appointmentId})`);
    }
}

export async function bookAppointment(
    appointment: AppointmentCreate,
): Promise<Appointment> {
    try {
        const { data } = await http.post<Appointment>(
            '/appointments',
            appointment,
        );
        return data;
    } catch (err) {
        throw mapAxiosError(err, 'bookAppointment');
    }
}

export async function cancelAppointment(
    appointmentId: string,
): Promise<Appointment> {
    try {
        const { data } = await http.delete<Appointment>(
            `/appointments/${encodeURIComponent(appointmentId)}`,
        );
        return data;
    } catch (err) {
        throw mapAxiosError(err, `cancelAppointment(${appointmentId})`);
    }
}

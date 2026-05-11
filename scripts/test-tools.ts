// Smoke tests for all VAPI tools.
// Resets the EMR sandbox to a clean state, then runs read-only tests in
// parallel followed by mutation tests in sequence. Mutation tests share
// state (a patient registered early on is the patient who books later).
//
// Prereq: dev server must be running (`npm run dev`).
// Usage: `npm test`

import 'dotenv/config';
import { resetEmr } from '../src/emr/api/admin.js';

const WEBHOOK_URL = 'http://localhost:3000/vapi/webhook';

// ─── Test infrastructure ────────────────────────────────────────────────────

type ExpectFn = (result: any) => boolean | string;

interface TestCase {
    name: string;
    toolName: string;
    args: Record<string, unknown>;
    customerPhone?: string;
    expect: ExpectFn;
}

interface TestResult {
    name: string;
    passed: boolean;
    detail?: string;
}

// Shared state across mutation tests. Populated as tests run sequentially.
const state: {
    newPatientId?: string;
    bookedAppointmentId?: string;
    rescheduledAppointmentId?: string;
    candidateSlot?: {
        provider_id: string;
        start_time: string;
        appointment_type: string;
    };
} = {};

async function callTool(
    toolName: string,
    args: Record<string, unknown>,
    customerPhone = '+15551234001',
): Promise<{ result?: any; error?: string; httpStatus: number }> {
    const payload = {
        message: {
            type: 'tool-calls',
            call: {
                id: `test-${Date.now()}-${Math.random()}`,
                customer: { number: customerPhone },
            },
            toolCallList: [
                {
                    id: `tc-${Date.now()}-${Math.random()}`,
                    function: { name: toolName, arguments: args },
                },
            ],
        },
    };

    const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    const body = await res.json().catch(() => null);
    const first = body?.results?.[0];

    return {
        httpStatus: res.status,
        result: first?.result ? JSON.parse(first.result) : undefined,
        error: first?.error,
    };
}

async function runTest(test: TestCase): Promise<TestResult> {
    try {
        const { result, error, httpStatus } = await callTool(
            test.toolName,
            test.args,
            test.customerPhone,
        );

        if (httpStatus !== 200) {
            return {
                name: test.name,
                passed: false,
                detail: `HTTP ${httpStatus}`,
            };
        }
        if (error) {
            return {
                name: test.name,
                passed: false,
                detail: `tool error: ${error}`,
            };
        }
        if (result === undefined) {
            return {
                name: test.name,
                passed: false,
                detail: 'no result in response',
            };
        }

        const verdict = test.expect(result);
        if (verdict === true) {
            return { name: test.name, passed: true };
        }
        const detail =
            typeof verdict === 'string'
                ? verdict
                : `unexpected result: ${JSON.stringify(result).slice(0, 200)}`;
        return { name: test.name, passed: false, detail };
    } catch (err) {
        return {
            name: test.name,
            passed: false,
            detail: `exception: ${(err as Error).message}`,
        };
    }
}

function logResult(r: TestResult) {
    const mark = r.passed ? '✅' : '❌';
    const detail = r.detail ? ` — ${r.detail}` : '';
    console.log(`${mark} ${r.name}${detail}`);
}

// ─── Read-only tests (parallel) ─────────────────────────────────────────────

const readOnlyTests: TestCase[] = [
    {
        name: 'lookup_patient: seeded patient by phone returns found',
        toolName: 'lookup_patient',
        args: { phone: '+15551234001' },
        expect: (r) =>
            r.status === 'found' && r.patient?.first_name === 'Maria',
    },
    {
        name: 'lookup_patient: unknown phone returns not_found',
        toolName: 'lookup_patient',
        args: { phone: '+19999999999' },
        expect: (r) => r.status === 'not_found',
    },
    {
        name: 'lookup_patient: name + DOB lookup returns found',
        toolName: 'lookup_patient',
        args: { last_name: 'Santos', date_of_birth: '1985-03-15' },
        expect: (r) =>
            r.status === 'found' && r.patient?.first_name === 'Maria',
    },
    {
        name: 'list_providers: no filters returns all 4',
        toolName: 'list_providers',
        args: {},
        expect: (r) => r.status === 'success' && r.providers?.length === 4,
    },
    {
        name: 'list_providers: specialty=electrophysiology returns 1',
        toolName: 'list_providers',
        args: { specialty: 'electrophysiology' },
        expect: (r) =>
            r.status === 'success' &&
            r.providers?.length === 1 &&
            r.providers[0].last_name === 'Kim',
    },
    {
        name: 'list_providers: appointment_type=stress_test filters to Kim only',
        toolName: 'list_providers',
        args: { appointment_type: 'stress_test' },
        expect: (r) =>
            r.status === 'success' &&
            r.providers?.length === 1 &&
            r.providers[0].last_name === 'Kim',
    },
];

// ─── Mutation tests (sequential, share state) ───────────────────────────────

const TEST_PHONE = '+15557779999';
const TEST_FIRST = 'Quinn';
const TEST_LAST = 'TestPatient';
const TEST_DOB = '1992-07-04';

async function mutationTests(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    // 1. Register a new patient.
    results.push(
        await runTest({
            name: 'register_patient: new patient returns success',
            toolName: 'register_patient',
            args: {
                first_name: TEST_FIRST,
                last_name: TEST_LAST,
                date_of_birth: TEST_DOB,
                phone: TEST_PHONE,
            },
            expect: (r) => {
                if (r.status !== 'success')
                    return `expected status=success, got ${r.status}`;
                if (!r.patient?.id) return 'missing patient.id';
                state.newPatientId = r.patient.id;
                return true;
            },
        }),
    );

    // 2. Same phone + same identity → already_registered, same id.
    results.push(
        await runTest({
            name: 'register_patient: same identity returns already_registered with same id',
            toolName: 'register_patient',
            args: {
                first_name: TEST_FIRST,
                last_name: TEST_LAST,
                date_of_birth: TEST_DOB,
                phone: TEST_PHONE,
            },
            expect: (r) => {
                if (r.status !== 'already_registered')
                    return `expected status=already_registered, got ${r.status}`;
                if (r.patient?.id !== state.newPatientId)
                    return `id mismatch: ${r.patient?.id} vs ${state.newPatientId}`;
                return true;
            },
        }),
    );

    // 3. Same phone, different identity → phone_conflict, no patient details.
    results.push(
        await runTest({
            name: 'register_patient: phone conflict hides existing patient details',
            toolName: 'register_patient',
            args: {
                first_name: 'Different',
                last_name: 'Person',
                date_of_birth: '1970-01-01',
                phone: TEST_PHONE,
            },
            expect: (r) => {
                if (r.status !== 'phone_conflict')
                    return `expected status=phone_conflict, got ${r.status}`;
                if (r.patient)
                    return 'phone_conflict must not include patient details (PHI guardrail)';
                return true;
            },
        }),
    );

    // 4. find_available_slots — success path. Uses newPatientId from step 1.
    results.push(
        await runTest({
            name: 'find_available_slots: new_patient returns 1-3 hydrated slots',
            toolName: 'find_available_slots',
            args: {
                patient_id: state.newPatientId,
                appointment_type: 'new_patient',
            },
            expect: (r) => {
                if (r.status !== 'success')
                    return `expected status=success, got ${r.status}`;
                if (!Array.isArray(r.slots) || r.slots.length === 0)
                    return 'expected at least one slot';
                if (r.slots.length > 3)
                    return `slot cap breached: got ${r.slots.length}`;
                const s = r.slots[0];
                if (!s.provider_id || !s.start_time || !s.end_time)
                    return 'slot missing required fields';
                if (typeof s.is_telehealth !== 'boolean')
                    return 'slot.is_telehealth must be boolean';
                if (s.appointment_type !== 'new_patient')
                    return `slot.appointment_type mismatch: ${s.appointment_type}`;
                if (
                    typeof s.provider_name !== 'string' ||
                    !s.provider_name.startsWith('Dr. ')
                )
                    return `provider_name not hydrated: ${s.provider_name}`;
                state.candidateSlot = {
                    provider_id: s.provider_id,
                    start_time: s.start_time,
                    appointment_type: s.appointment_type,
                };
                return true;
            },
        }),
    );

    // 5. find_available_slots — no_slots path. Saturday-only is impossible:
    //    all providers' restrictions exclude Saturdays.
    results.push(
        await runTest({
            name: 'find_available_slots: restrictive filter returns no_slots with searched_with',
            toolName: 'find_available_slots',
            args: {
                patient_id: state.newPatientId,
                appointment_type: 'new_patient',
                days_of_week: 'SAT',
            },
            expect: (r) => {
                if (r.status !== 'no_slots')
                    return `expected status=no_slots, got ${r.status}`;
                if (!r.searched_with)
                    return 'no_slots must include searched_with';
                if (r.searched_with.days_of_week !== 'SAT')
                    return `searched_with.days_of_week mismatch: ${r.searched_with.days_of_week}`;
                if (r.searched_with.appointment_type !== 'new_patient')
                    return 'searched_with.appointment_type missing';
                if ('patient_id' in r.searched_with)
                    return 'searched_with should not echo patient_id';
                return true;
            },
        }),
    );

    // 6. find_available_slots — invalid args path (bad date format).
    results.push(
        await runTest({
            name: 'find_available_slots: rejects malformed start_date',
            toolName: 'find_available_slots',
            args: {
                patient_id: state.newPatientId,
                appointment_type: 'new_patient',
                start_date: '06/01/2026',
            },
            expect: () => {
                // Reaching here means the tool returned ok:true, which is wrong.
                return 'expected tool error from invalid start_date, got result';
            },
        }).then((r) => {
            // Invert: we WANT this to fail validation. The runner reports a
            // failed `passed` flag when error is set, so flip its verdict.
            if (
                r.detail?.startsWith('tool error: Invalid arguments:') &&
                r.detail.includes('start_date')
            ) {
                return { name: r.name, passed: true };
            }
            return r;
        }),
    );

    // 7. book_appointment — success path. Uses the slot captured in step 4.
    results.push(
        await runTest({
            name: 'book_appointment: candidate slot books successfully',
            toolName: 'book_appointment',
            args: {
                patient_id: state.newPatientId,
                provider_id: state.candidateSlot?.provider_id,
                start_time: state.candidateSlot?.start_time,
                appointment_type: state.candidateSlot?.appointment_type,
                reason: 'Initial cardiology consultation',
            },
            expect: (r) => {
                if (r.status !== 'success')
                    return `expected status=success, got ${r.status}`;
                if (!r.appointment?.id) return 'missing appointment.id';
                if (r.appointment.start_time !== state.candidateSlot?.start_time)
                    return `start_time mismatch: ${r.appointment.start_time} vs ${state.candidateSlot?.start_time}`;
                if (typeof r.appointment.is_telehealth !== 'boolean')
                    return 'appointment.is_telehealth must be boolean';
                if (
                    typeof r.appointment.provider_name !== 'string' ||
                    !r.appointment.provider_name.startsWith('Dr. ')
                )
                    return `provider_name not hydrated: ${r.appointment.provider_name}`;
                state.bookedAppointmentId = r.appointment.id;
                return true;
            },
        }),
    );

    // 8. book_appointment — slot_taken path. Booking the same slot again
    //    should 409 since it was just claimed.
    results.push(
        await runTest({
            name: 'book_appointment: re-booking same slot returns slot_taken',
            toolName: 'book_appointment',
            args: {
                patient_id: state.newPatientId,
                provider_id: state.candidateSlot?.provider_id,
                start_time: state.candidateSlot?.start_time,
                appointment_type: state.candidateSlot?.appointment_type,
            },
            expect: (r) => {
                if (r.status !== 'slot_taken')
                    return `expected status=slot_taken, got ${r.status}`;
                if (r.appointment)
                    return 'slot_taken must not include appointment details';
                return true;
            },
        }),
    );

    // 9. book_appointment — invalid args (bad ISO timestamp).
    results.push(
        await runTest({
            name: 'book_appointment: rejects non-ISO start_time',
            toolName: 'book_appointment',
            args: {
                patient_id: state.newPatientId,
                provider_id: state.candidateSlot?.provider_id,
                start_time: '2026-06-01 10:00 AM',
                appointment_type: state.candidateSlot?.appointment_type,
            },
            expect: () => 'expected tool error from invalid start_time, got result',
        }).then((r) => {
            if (
                r.detail?.startsWith('tool error: Invalid arguments:') &&
                r.detail.includes('start_time')
            ) {
                return { name: r.name, passed: true };
            }
            return r;
        }),
    );

    // 10. list_patient_appointments — the appointment booked in step 7 should
    //     show up. We pass include_past=true so the test is robust against the
    //     slot's start_time being before "now" (the EMR returns same-day slots
    //     and the test could run after 4 PM local time).
    results.push(
        await runTest({
            name: 'list_patient_appointments: includes the booked appointment',
            toolName: 'list_patient_appointments',
            args: {
                patient_id: state.newPatientId,
                include_past: true,
            },
            expect: (r) => {
                if (r.status !== 'success')
                    return `expected status=success, got ${r.status}`;
                if (!Array.isArray(r.appointments) || r.appointments.length === 0)
                    return 'expected at least one appointment';
                const ours = r.appointments.find(
                    (a: { id?: string }) => a.id === state.bookedAppointmentId,
                );
                if (!ours)
                    return `booked appointment ${state.bookedAppointmentId} not found in list`;
                if (ours.status !== 'scheduled')
                    return `expected status=scheduled, got ${ours.status}`;
                if (ours.appointment_type !== 'new_patient')
                    return `appointment_type mismatch: ${ours.appointment_type}`;
                if (
                    typeof ours.provider_name !== 'string' ||
                    !ours.provider_name.startsWith('Dr. ')
                )
                    return `provider_name not hydrated: ${ours.provider_name}`;
                if (typeof ours.is_telehealth !== 'boolean')
                    return 'is_telehealth must be boolean';
                if (!ours.start_time || !ours.end_time)
                    return 'missing start_time/end_time';
                if (!('reason' in ours))
                    return 'reason field must be present (nullable)';
                return true;
            },
        }),
    );

    // 11. list_patient_appointments — invalid args (extra field rejected).
    results.push(
        await runTest({
            name: 'list_patient_appointments: strict schema rejects unknown field',
            toolName: 'list_patient_appointments',
            args: {
                patient_id: state.newPatientId,
                bogus_filter: 'nope',
            },
            expect: () => 'expected tool error, got result',
        }).then((r) => {
            if (
                r.detail?.startsWith('tool error: Invalid arguments:') &&
                r.detail.includes('bogus_filter')
            ) {
                return { name: r.name, passed: true };
            }
            return r;
        }),
    );

    // 12. cancel_appointment — success path. Cancels the appointment booked
    //     in step 7.
    results.push(
        await runTest({
            name: 'cancel_appointment: booked appointment cancels successfully',
            toolName: 'cancel_appointment',
            args: { appointment_id: state.bookedAppointmentId },
            expect: (r) => {
                if (r.status !== 'success')
                    return `expected status=success, got ${r.status}`;
                if (r.appointment?.status !== 'cancelled')
                    return `appointment.status should be 'cancelled', got ${r.appointment?.status}`;
                if (
                    typeof r.appointment?.provider_name !== 'string' ||
                    !r.appointment.provider_name.startsWith('Dr. ')
                )
                    return `provider_name not hydrated: ${r.appointment?.provider_name}`;
                if (!r.appointment?.start_time)
                    return 'appointment.start_time missing';
                return true;
            },
        }),
    );

    // 13. cancel_appointment — second cancel returns already_cancelled.
    results.push(
        await runTest({
            name: 'cancel_appointment: re-cancel returns already_cancelled',
            toolName: 'cancel_appointment',
            args: { appointment_id: state.bookedAppointmentId },
            expect: (r) => {
                if (r.status !== 'already_cancelled')
                    return `expected status=already_cancelled, got ${r.status}`;
                if (
                    typeof r.appointment?.provider_name !== 'string' ||
                    !r.appointment.provider_name.startsWith('Dr. ')
                )
                    return `provider_name not hydrated: ${r.appointment?.provider_name}`;
                if (!r.appointment?.start_time)
                    return 'appointment.start_time missing';
                return true;
            },
        }),
    );

    // 14. cancel_appointment — unknown id returns not_found.
    results.push(
        await runTest({
            name: 'cancel_appointment: unknown id returns not_found',
            toolName: 'cancel_appointment',
            args: { appointment_id: 'appt_does_not_exist_xyz' },
            expect: (r) => {
                if (r.status !== 'not_found')
                    return `expected status=not_found, got ${r.status}`;
                if (r.appointment)
                    return 'not_found must not include appointment details';
                return true;
            },
        }),
    );

    // TODO: reschedule_appointment
    //   - Book a new appointment, then reschedule it to a different slot
    //   - Verify the original is cancelled and new is scheduled

    return results;
}

// ─── Runner ─────────────────────────────────────────────────────────────────

async function main() {
    console.log('Resetting EMR sandbox...');
    try {
        await resetEmr();
        console.log('✅ EMR reset complete\n');
    } catch (err) {
        console.error('❌ EMR reset failed:', (err as Error).message);
        console.error('   Is the EMR sandbox reachable?');
        process.exit(1);
    }

    console.log('--- Read-only tests (parallel) ---');
    const readResults = await Promise.all(readOnlyTests.map(runTest));
    readResults.forEach(logResult);

    console.log('\n--- Mutation tests (sequential) ---');
    const mutResults = await mutationTests();
    mutResults.forEach(logResult);

    const all = [...readResults, ...mutResults];
    const passed = all.filter((r) => r.passed).length;
    const failed = all.length - passed;
    console.log(`\n${passed} passed, ${failed} failed`);

    if (failed > 0) process.exit(1);
}

main().catch((err) => {
    console.error('Test runner crashed:', err);
    process.exit(1);
});

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

    // TODO: find_available_slots
    //   - Requires state.newPatientId
    //   - Test: success path with appointment_type=new_patient
    //   - Test: no_slots path with overly restrictive filter (e.g., days_of_week=SAT)

    // TODO: book_appointment
    //   - Requires a slot from find_available_slots
    //   - Capture state.bookedAppointmentId from the result

    // TODO: list_patient_appointments
    //   - Should return the appointment we just booked

    // TODO: cancel_appointment
    //   - Cancel state.bookedAppointmentId
    //   - Verify status === 'cancelled' in response

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

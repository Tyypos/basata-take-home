import 'dotenv/config';
import { listProviders, searchPatients } from '../src/emr/api';

async function main() {
    await checkListProviders();
    await checkSearchPatients();
}

async function checkListProviders() {
    console.log('Listing providers...');
    const providers = await listProviders();
    console.log(`Found ${providers.length} providers:`);
    for (const p of providers) {
        console.log(
            `  - ${p.first_name} ${p.last_name}, ${p.title} (${p.specialties.join(', ')})`,
        );
        if (p.restrictions) console.log(`    Restrictions: ${p.restrictions}`);
    }
}

async function checkSearchPatients() {
    console.log('\nSearching patients by phone');
    const patients = await searchPatients({ phone: '+15551234001' });
    console.log(`Found ${patients.length} patients`);
}

main().catch((err) => {
    console.error('Smoke test failed:', err.name, err.message);
    if (err.responseBody)
        console.error(
            'Response body:',
            JSON.stringify(err.responseBody, null, 2),
        );
    process.exit(1);
});

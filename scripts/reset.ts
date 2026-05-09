import 'dotenv/config';
import { resetEmr } from '../src/emr/api/admin.js';

async function main() {
    console.log('Resetting EMR state...');
    await resetEmr();
    console.log('✓ EMR reset complete');
}

main().catch((err) => {
    console.error('Reset failed:', err.name, err.message);
    if (err.responseBody) {
        console.error(
            'Response body:',
            JSON.stringify(err.responseBody, null, 2),
        );
    }
    process.exit(1);
});

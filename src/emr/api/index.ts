// Public surface of the EMR API layer. Re-exports the per-resource wrappers
// so consumers can import any EMR call from a single path.
// Excludes http.ts intentionally — it's an implementation detail.

export * from './patients.js';
export * from './providers.js';
export * from './slots.js';
export * from './appointments.js';
export * from './admin.js';

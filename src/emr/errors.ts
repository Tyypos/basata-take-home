// Custom error types for EMR interactions.
// The client throws these based on HTTP status; tool handlers catch and translate
// to user-facing messages (or LLM-readable error strings).

export class EmrError extends Error {
    public readonly status?: number;
    public readonly responseBody?: unknown;

    constructor(message: string, status?: number, responseBody?: unknown) {
        super(message);
        this.name = 'EmrError';
        this.status = status;
        this.responseBody = responseBody;
    }
}

// Resource not found (404). e.g. cancelling a non-existent appointment ID.
export class EmrNotFoundError extends EmrError {
    constructor(message: string, responseBody?: unknown) {
        super(message, 404, responseBody);
        this.name = 'EmrNotFoundError';
    }
}

// Conflict (409). e.g. slot already booked, or duplicate phone on patient create.
export class EmrConflictError extends EmrError {
    constructor(message: string, responseBody?: unknown) {
        super(message, 409, responseBody);
        this.name = 'EmrConflictError';
    }
}

// Validation error from EMR (422). e.g. malformed date, invalid enum value.
// Should rarely happen if our types are right — usually indicates a bug.
export class EmrValidationFailed extends EmrError {
    constructor(message: string, responseBody?: unknown) {
        super(message, 422, responseBody);
        this.name = 'EmrValidationFailed';
    }
}

// EMR is down, slow, or returning 5xx. The "EMR being slow or down" case
// the brief explicitly calls out. Tool handlers should catch this and offer
// transfer to a human.
export class EmrUnavailableError extends EmrError {
    constructor(message: string, status?: number, responseBody?: unknown) {
        super(message, status, responseBody);
        this.name = 'EmrUnavailableError';
    }
}

/**
 * Base error class for OpenTR8
 */
export class OpenTR8Error extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'OpenTR8Error';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

// Common error types
export class NotFoundError extends OpenTR8Error {
  constructor(resource: string, id?: string) {
    super(
      id ? `${resource} with id '${id}' not found` : `${resource} not found`,
      'NOT_FOUND',
      404
    );
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends OpenTR8Error {
  constructor(message: string = 'Invalid or missing API key') {
    super(message, 'UNAUTHORIZED', 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends OpenTR8Error {
  constructor(message: string = 'You do not have permission to perform this action') {
    super(message, 'FORBIDDEN', 403);
    this.name = 'ForbiddenError';
  }
}

export class BadRequestError extends OpenTR8Error {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'BAD_REQUEST', 400, details);
    this.name = 'BadRequestError';
  }
}

export class ConflictError extends OpenTR8Error {
  constructor(message: string) {
    super(message, 'CONFLICT', 409);
    this.name = 'ConflictError';
  }
}

export class InsufficientCreditsError extends OpenTR8Error {
  constructor(required: bigint, available: bigint) {
    super(
      `Insufficient credits: required ${required}, available ${available}`,
      'INSUFFICIENT_CREDITS',
      400,
      { required: required.toString(), available: available.toString() }
    );
    this.name = 'InsufficientCreditsError';
  }
}

export class InvalidStateError extends OpenTR8Error {
  constructor(currentState: string, action: string) {
    super(
      `Cannot ${action} in current state: ${currentState}`,
      'INVALID_STATE',
      400,
      { currentState, action }
    );
    this.name = 'InvalidStateError';
  }
}

export class SchemaValidationError extends OpenTR8Error {
  constructor(message: string, errors: unknown[]) {
    super(message, 'SCHEMA_VALIDATION_ERROR', 400, { errors });
    this.name = 'SchemaValidationError';
  }
}

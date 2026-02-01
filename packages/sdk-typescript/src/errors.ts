/**
 * Base error class for all OpenTR8 SDK errors
 */
export class OpenTR8Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenTR8Error';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when an API request fails
 */
export class ApiError extends OpenTR8Error {
  public readonly statusCode: number;
  public readonly response?: unknown;

  constructor(message: string, statusCode: number, response?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.response = response;
  }
}

/**
 * Error thrown when authentication fails (401)
 */
export class AuthenticationError extends ApiError {
  constructor(message: string = 'Authentication failed. Please check your API key.') {
    super(message, 401);
    this.name = 'AuthenticationError';
  }
}

/**
 * Error thrown when a resource is not found (404)
 */
export class NotFoundError extends ApiError {
  constructor(message: string = 'The requested resource was not found.') {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

/**
 * Error thrown when request validation fails (400)
 */
export class ValidationError extends ApiError {
  public readonly errors?: Record<string, string[]>;

  constructor(message: string = 'Validation failed.', errors?: Record<string, string[]>) {
    super(message, 400);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

import {
  OpenTR8Error,
  NotFoundError,
  UnauthorizedError,
  BadRequestError,
  InsufficientCreditsError,
  InvalidStateError,
} from '../errors.js';

describe('Error Classes', () => {
  describe('OpenTR8Error', () => {
    it('should create an error with correct properties', () => {
      const error = new OpenTR8Error('Test error', 'TEST_CODE', 400, { foo: 'bar' });
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual({ foo: 'bar' });
    });

    it('should serialize to JSON correctly', () => {
      const error = new OpenTR8Error('Test', 'CODE', 500);
      const json = error.toJSON();
      expect(json.error.code).toBe('CODE');
      expect(json.error.message).toBe('Test');
    });
  });

  describe('NotFoundError', () => {
    it('should have 404 status code', () => {
      const error = new NotFoundError('Task', '123');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
      expect(error.message).toContain('Task');
      expect(error.message).toContain('123');
    });
  });

  describe('UnauthorizedError', () => {
    it('should have 401 status code', () => {
      const error = new UnauthorizedError();
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('BadRequestError', () => {
    it('should have 400 status code', () => {
      const error = new BadRequestError('Invalid input');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('BAD_REQUEST');
    });
  });

  describe('InsufficientCreditsError', () => {
    it('should include required and available amounts', () => {
      const error = new InsufficientCreditsError(BigInt(1000), BigInt(500));
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('INSUFFICIENT_CREDITS');
      expect(error.details?.required).toBe('1000');
      expect(error.details?.available).toBe('500');
    });
  });

  describe('InvalidStateError', () => {
    it('should include state and action', () => {
      const error = new InvalidStateError('COMPLETED', 'accept');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('INVALID_STATE');
      expect(error.details?.currentState).toBe('COMPLETED');
      expect(error.details?.action).toBe('accept');
    });
  });
});

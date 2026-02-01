import { calculateDeadline, isExpired } from '../config.js';

describe('Config Utilities', () => {
  describe('calculateDeadline', () => {
    it('should calculate a deadline in the future', () => {
      const now = new Date();
      const deadline = calculateDeadline(24);
      expect(deadline.getTime()).toBeGreaterThan(now.getTime());
    });

    it('should add the correct number of hours', () => {
      const before = new Date();
      const hours = 48;
      const deadline = calculateDeadline(hours);
      const after = new Date();

      // Deadline should be ~48 hours from now
      const diffMs = deadline.getTime() - before.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      expect(diffHours).toBeGreaterThanOrEqual(hours);
      expect(diffHours).toBeLessThanOrEqual(hours + 0.01); // Small tolerance
    });
  });

  describe('isExpired', () => {
    it('should return false for future dates', () => {
      const future = new Date(Date.now() + 60000); // 1 minute from now
      expect(isExpired(future)).toBe(false);
    });

    it('should return true for past dates', () => {
      const past = new Date(Date.now() - 60000); // 1 minute ago
      expect(isExpired(past)).toBe(true);
    });
  });
});

import { generateApiKey, hashApiKey, isValidApiKeyFormat, maskApiKey } from '../api-key.js';

describe('API Key Utilities', () => {
  describe('generateApiKey', () => {
    it('should generate a key with the correct prefix', () => {
      const key = generateApiKey();
      expect(key.startsWith('otr8_')).toBe(true);
    });

    it('should generate a key of the correct length', () => {
      const key = generateApiKey();
      // otr8_ (5) + 64 hex chars = 69
      expect(key.length).toBe(69);
    });

    it('should generate unique keys', () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe('hashApiKey', () => {
    it('should produce consistent hashes', () => {
      const key = 'otr8_abc123';
      const hash1 = hashApiKey(key);
      const hash2 = hashApiKey(key);
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different keys', () => {
      const hash1 = hashApiKey('otr8_abc123');
      const hash2 = hashApiKey('otr8_xyz789');
      expect(hash1).not.toBe(hash2);
    });

    it('should produce a 64-character hex string (SHA-256)', () => {
      const key = generateApiKey();
      const hash = hashApiKey(key);
      expect(hash.length).toBe(64);
      expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
    });
  });

  describe('isValidApiKeyFormat', () => {
    it('should return true for valid keys', () => {
      const key = generateApiKey();
      expect(isValidApiKeyFormat(key)).toBe(true);
    });

    it('should return false for keys without prefix', () => {
      expect(isValidApiKeyFormat('abc123')).toBe(false);
    });

    it('should return false for keys with wrong prefix', () => {
      expect(isValidApiKeyFormat('wrong_abc123')).toBe(false);
    });

    it('should return false for keys that are too short', () => {
      expect(isValidApiKeyFormat('otr8_abc')).toBe(false);
    });
  });

  describe('maskApiKey', () => {
    it('should mask the middle of the key', () => {
      const key = generateApiKey();
      const masked = maskApiKey(key);
      expect(masked.startsWith('otr8_')).toBe(true);
      expect(masked.includes('...')).toBe(true);
    });

    it('should show first 12 and last 4 characters', () => {
      const key = generateApiKey();
      const masked = maskApiKey(key);
      expect(masked.slice(0, 12)).toBe(key.slice(0, 12));
      expect(masked.slice(-4)).toBe(key.slice(-4));
    });

    it('should handle very short strings gracefully', () => {
      const masked = maskApiKey('abc');
      expect(masked).toBe('****');
    });
  });
});

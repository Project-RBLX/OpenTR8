/**
 * Tests for the escrow service entry point
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { setupFakeTimers, restoreTimers, advanceTimers } from './setup.js';

// Store process event handlers for testing
let signalHandlers: Map<string, () => void>;
let processExitMock: jest.SpiedFunction<typeof process.exit>;

// Mock processExpiredTasks
const mockProcessExpiredTasks = jest.fn<() => Promise<number>>();

jest.unstable_mockModule('../processor.js', () => ({
  processExpiredTasks: mockProcessExpiredTasks,
}));

describe('Escrow Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFakeTimers();
    signalHandlers = new Map();

    // Mock process.on to capture signal handlers
    jest.spyOn(process, 'on').mockImplementation((event: string, handler: () => void) => {
      signalHandlers.set(event, handler);
      return process;
    });

    // Mock process.exit
    processExitMock = jest.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: number) => never);

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    // Reset mock return value
    mockProcessExpiredTasks.mockResolvedValue(0);
  });

  afterEach(() => {
    restoreTimers();
    jest.restoreAllMocks();
  });

  describe('service startup', () => {
    it('should log startup message', async () => {
      const consoleSpy = jest.spyOn(console, 'log');

      // Import the module to trigger startup
      await import('../index.js');

      // Run initial execution
      await Promise.resolve();

      expect(consoleSpy).toHaveBeenCalledWith('OpenTR8 Escrow Service starting...');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Poll interval:'));
    });

    it('should immediately call processExpiredTasks on start', async () => {
      mockProcessExpiredTasks.mockResolvedValue(0);

      // Import triggers the run function
      await import('../index.js');

      // Wait for async execution
      await Promise.resolve();

      expect(mockProcessExpiredTasks).toHaveBeenCalledTimes(1);
    });

    it('should log when tasks are processed', async () => {
      mockProcessExpiredTasks.mockResolvedValue(5);
      const consoleSpy = jest.spyOn(console, 'log');

      await import('../index.js');
      await Promise.resolve();

      expect(consoleSpy).toHaveBeenCalledWith('Processed 5 expired task(s)');
    });

    it('should not log when no tasks are processed', async () => {
      mockProcessExpiredTasks.mockResolvedValue(0);
      const consoleSpy = jest.spyOn(console, 'log');

      await import('../index.js');
      await Promise.resolve();

      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('expired task(s)'));
    });
  });

  describe('polling interval', () => {
    it('should schedule next run after 60 seconds', async () => {
      mockProcessExpiredTasks.mockResolvedValue(0);

      await import('../index.js');
      await Promise.resolve();

      // First call on startup
      expect(mockProcessExpiredTasks).toHaveBeenCalledTimes(1);

      // Advance time by 60 seconds
      advanceTimers(60_000);
      await Promise.resolve();

      // Second call after interval
      expect(mockProcessExpiredTasks).toHaveBeenCalledTimes(2);
    });

    it('should continue polling on subsequent intervals', async () => {
      mockProcessExpiredTasks.mockResolvedValue(0);

      await import('../index.js');
      await Promise.resolve();

      expect(mockProcessExpiredTasks).toHaveBeenCalledTimes(1);

      // Advance through multiple intervals
      for (let i = 0; i < 3; i++) {
        advanceTimers(60_000);
        await Promise.resolve();
      }

      expect(mockProcessExpiredTasks).toHaveBeenCalledTimes(4);
    });

    it('should not run before 60 seconds', async () => {
      mockProcessExpiredTasks.mockResolvedValue(0);

      await import('../index.js');
      await Promise.resolve();

      expect(mockProcessExpiredTasks).toHaveBeenCalledTimes(1);

      // Advance by 30 seconds (less than interval)
      advanceTimers(30_000);
      await Promise.resolve();

      // Should still be 1 call
      expect(mockProcessExpiredTasks).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('should log errors but continue running', async () => {
      const error = new Error('Processing failed');
      mockProcessExpiredTasks
        .mockRejectedValueOnce(error)
        .mockResolvedValue(0);

      const consoleSpy = jest.spyOn(console, 'error');

      await import('../index.js');
      await Promise.resolve();

      expect(consoleSpy).toHaveBeenCalledWith('Error processing expired tasks:', error);

      // Should still schedule next run
      advanceTimers(60_000);
      await Promise.resolve();

      expect(mockProcessExpiredTasks).toHaveBeenCalledTimes(2);
    });
  });

  describe('graceful shutdown', () => {
    it('should register SIGTERM handler', async () => {
      await import('../index.js');

      expect(signalHandlers.has('SIGTERM')).toBe(true);
    });

    it('should register SIGINT handler', async () => {
      await import('../index.js');

      expect(signalHandlers.has('SIGINT')).toBe(true);
    });

    it('should exit gracefully on SIGTERM', async () => {
      const consoleSpy = jest.spyOn(console, 'log');

      await import('../index.js');

      const sigtermHandler = signalHandlers.get('SIGTERM');
      expect(sigtermHandler).toBeDefined();

      sigtermHandler!();

      expect(consoleSpy).toHaveBeenCalledWith('Received SIGTERM, shutting down...');
      expect(processExitMock).toHaveBeenCalledWith(0);
    });

    it('should exit gracefully on SIGINT', async () => {
      const consoleSpy = jest.spyOn(console, 'log');

      await import('../index.js');

      const sigintHandler = signalHandlers.get('SIGINT');
      expect(sigintHandler).toBeDefined();

      sigintHandler!();

      expect(consoleSpy).toHaveBeenCalledWith('Received SIGINT, shutting down...');
      expect(processExitMock).toHaveBeenCalledWith(0);
    });
  });
});

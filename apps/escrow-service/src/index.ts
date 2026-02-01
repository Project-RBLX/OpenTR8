import { processExpiredTasks } from './processor.js';

const POLL_INTERVAL_MS = 60_000; // Check every minute

console.log('OpenTR8 Escrow Service starting...');
console.log(`Poll interval: ${POLL_INTERVAL_MS}ms`);

async function run(): Promise<void> {
  console.log('Running expired task processor...');

  try {
    const processed = await processExpiredTasks();
    if (processed > 0) {
      console.log(`Processed ${processed} expired task(s)`);
    }
  } catch (error) {
    console.error('Error processing expired tasks:', error);
  }

  // Schedule next run
  setTimeout(run, POLL_INTERVAL_MS);
}

// Start processing
run();

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  process.exit(0);
});

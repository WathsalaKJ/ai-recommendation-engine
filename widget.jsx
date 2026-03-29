// ─────────────────────────────────────────────────────────────
// parallelQueue.js
// Multiple parallel queues with round-robin job distribution.
//
// Use this when you have thousands of records to process and
// a single queue is too slow. Each queue runs independently
// with its own concurrency limit.
//
// Example with defaults (3 queues × 3 concurrency):
//   → up to 9 simultaneous Claude API calls
//   → 1000 leads processed ~3x faster than a single queue
//
// Round-robin distribution:
//   Job 0 → Queue 0
//   Job 1 → Queue 1
//   Job 2 → Queue 2
//   Job 3 → Queue 0  (wraps back)
//   ...and so on
// ─────────────────────────────────────────────────────────────

import PQueue from 'p-queue';
import { callClaudeWithRetry } from './api.js';
import { buildPrompt } from './prompt.js';

const NUM_QUEUES   = 3;
const CONCURRENCY  = 3; // per queue — total max = NUM_QUEUES × CONCURRENCY


// ─────────────────────────────────────────────────────────────
// processLeadsInParallel
// Splits leads across N queues, runs them all simultaneously,
// and waits for every queue to drain before returning results.
// ─────────────────────────────────────────────────────────────

/**
 * Process leads across multiple parallel queues.
 * @param {Array} leads - Your full leads array
 * @param {number} numQueues - How many parallel queues to create
 * @param {number} concurrency - Concurrent calls per queue
 * @returns {Promise<Array>} All results when every queue is idle
 */
export async function processLeadsInParallel(
  leads,
  numQueues   = NUM_QUEUES,
  concurrency = CONCURRENCY
) {

  // Create N independent queues
  const queues = Array.from(
    { length: numQueues },
    () => new PQueue({ concurrency })
  );

  console.log(
    `Processing ${leads.length} leads across ${numQueues} queues ` +
    `(${concurrency} concurrent each = ${numQueues * concurrency} max simultaneous)`
  );

  const results = [];

  // Distribute jobs round-robin across queues
  leads.forEach((lead, i) => {
    const queue = queues[i % numQueues]; // round-robin pick

    queue.add(async () => {
      const { user, system } = buildPrompt([lead]);
      const response = await callClaudeWithRetry(user, system);

      results.push({
        leadId:   lead.id,
        name:     lead.name,
        analysis: JSON.parse(response)
      });
    });
  });

  // Wait for ALL queues to drain
  await Promise.all(queues.map(q => q.onIdle()));

  console.log(`✓ All ${results.length} leads processed across ${numQueues} queues`);
  return results;
}


// ─────────────────────────────────────────────────────────────
// getQueueStats
// Returns a snapshot of all queue sizes — useful for a
// progress dashboard or health check endpoint.
// ─────────────────────────────────────────────────────────────

/**
 * Get current stats for an array of PQueue instances.
 * @param {PQueue[]} queues
 * @returns {Object} { totalWaiting, totalRunning, queues[] }
 */
export function getQueueStats(queues) {
  const stats = queues.map((q, i) => ({
    queueIndex: i,
    waiting:    q.size,
    running:    q.pending,
    isPaused:   q.isPaused
  }));

  return {
    totalWaiting: stats.reduce((sum, q) => sum + q.waiting, 0),
    totalRunning: stats.reduce((sum, q) => sum + q.running, 0),
    queues:       stats
  };
}

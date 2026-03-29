// ─────────────────────────────────────────────────────────────
// queue.js
// Single queue with concurrency control using p-queue.
//
// Use this when you have up to a few hundred records to process
// and want to avoid hitting Anthropic's rate limits.
//
// concurrency: 3 means a maximum of 3 Claude API calls run
// at the same time. p-queue automatically holds the rest and
// starts the next job the moment any running job finishes.
//
// Install: npm install p-queue
// ─────────────────────────────────────────────────────────────

import PQueue from 'p-queue';
import { callClaudeWithRetry } from './api.js';
import { buildPrompt } from './prompt.js';

const CONCURRENCY = 3;


// ─────────────────────────────────────────────────────────────
// processLeadsWithQueue
// Takes an array of leads, runs Claude on each one at a
// controlled pace, and returns all results when done.
// ─────────────────────────────────────────────────────────────

/**
 * Process an array of leads through a single rate-controlled queue.
 * @param {Array} leads - Your full leads array (any size)
 * @returns {Promise<Array>} Array of { leadId, analysis } objects
 */
export async function processLeadsWithQueue(leads) {

  // Create one queue — max 3 API calls running simultaneously
  const queue = new PQueue({ concurrency: CONCURRENCY });

  console.log(`Processing ${leads.length} leads with concurrency ${CONCURRENCY}...`);

  // Add every lead to the queue at once.
  // p-queue runs them 3 at a time automatically.
  const results = await Promise.all(
    leads.map(lead =>
      queue.add(async () => {

        const { user, system } = buildPrompt([lead]);

        const response = await callClaudeWithRetry(user, system);

        return {
          leadId:   lead.id,
          name:     lead.name,
          analysis: JSON.parse(response)
        };
      })
    )
  );

  console.log(`✓ All ${results.length} leads processed`);
  return results;
}


// ─────────────────────────────────────────────────────────────
// Queue event listeners — useful for progress tracking
// Attach these to your queue instance for live updates.
// ─────────────────────────────────────────────────────────────

/**
 * Attach progress logging to a PQueue instance.
 * @param {PQueue} queue
 */
export function attachQueueListeners(queue) {
  queue.on('active', () => {
    console.log(`Queue: ${queue.size} jobs waiting, ${queue.pending} running`);
  });

  queue.on('idle', () => {
    console.log('Queue: all jobs finished');
  });

  queue.on('error', (error) => {
    console.error('Queue error:', error.message);
  });
}

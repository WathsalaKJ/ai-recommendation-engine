// ─────────────────────────────────────────────────────────────
// jobQueue.js
// Production-grade job system with retry queue and dead letter queue.
//
// Every lead is wrapped in a "job envelope" that tracks:
//   - id          → unique ticket number
//   - payload     → the original lead data
//   - attempts    → how many times we have tried
//   - maxAttempts → give up after this many failures
//   - nextRetryAt → timestamp: do not retry before this moment
//   - status      → pending / done / retrying / dead
//
// When a job fails:
//   1. scheduleRetry() stamps it with a future retry time
//   2. The job moves to the retryQueue (a plain array)
//   3. startRetryWorker() polls every second
//   4. When the retry time passes, the job re-enters a main queue
//   5. After maxAttempts failures the job moves to deadLetter
//
// Think of it like a postal system:
//   Main queues   = delivery trucks running parallel routes
//   Retry queue   = holding shelf ("try again in 4 seconds")
//   Dead letter   = undeliverable mail — needs human investigation
// ─────────────────────────────────────────────────────────────

import PQueue from 'p-queue';


// ─────────────────────────────────────────────────────────────
// createJob
// Wraps raw lead data in a job envelope with tracking fields.
// Always use this before adding anything to a queue.
// ─────────────────────────────────────────────────────────────

/**
 * Wrap lead data in a job envelope.
 * @param {Object} leadData - Your raw lead object
 * @returns {Object} Job envelope
 */
export function createJob(leadData) {
  return {
    id:          crypto.randomUUID(), // unique ticket per job
    payload:     leadData,            // original data — never mutated
    attempts:    0,                   // incremented on each try
    maxAttempts: 3,                   // give up after 3 failures
    nextRetryAt: null,                // set by scheduleRetry()
    status:      'pending'            // pending | done | retrying | dead
  };
}


// ─────────────────────────────────────────────────────────────
// processJob
// Runs one job: calls Claude, handles the response, and routes
// the job to results, retry queue, or dead letter accordingly.
// ─────────────────────────────────────────────────────────────

/**
 * Process a single job against the Claude API.
 * @param {Object} job         - Job envelope from createJob()
 * @param {Array}  retryQueue  - Shared retry queue array
 * @param {Array}  results     - Shared results array
 * @param {Array}  deadLetter  - Shared dead letter array
 */
export async function processJob(job, retryQueue, results, deadLetter) {
  job.attempts++;
  job.status = 'processing';

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages:   [{ role: 'user', content: JSON.stringify(job.payload) }]
      })
    });

    // ── SUCCESS ──────────────────────────────────────────────
    if (response.ok) {
      const data = await response.json();
      job.status = 'done';
      results.push({
        jobId:  job.id,
        leadId: job.payload.id,
        result: data.content[0].text
      });
      console.log(`✓ Job ${short(job.id)} done (attempt ${job.attempts})`);
      return;
    }

    // ── 4xx errors (not 429) — your fault, move to dead letter ─
    // Bad API key, malformed request, no permission.
    // Retrying will fail identically — fix the code instead.
    if (response.status >= 400 && response.status < 500
        && response.status !== 429) {
      job.status = 'dead';
      const err  = await response.json().catch(() => ({}));
      deadLetter.push({ job, reason: `HTTP ${response.status}: ${err.error?.message}` });
      console.error(`✗ Job ${short(job.id)} fatal error ${response.status} — moved to dead letter`);
      return;
    }

    // ── 429 or 5xx — temporary server issue, schedule retry ──
    scheduleRetry(job, retryQueue, deadLetter, `HTTP ${response.status}`);

  } catch (networkError) {
    // fetch() threw — no internet, DNS failure, or timeout
    scheduleRetry(job, retryQueue, deadLetter, 'NETWORK_ERROR');
  }
}


// ─────────────────────────────────────────────────────────────
// scheduleRetry
// Stamps the job with a future retry timestamp and pushes it
// to the retry queue. If maxAttempts is reached, moves the
// job to the dead letter queue instead.
// ─────────────────────────────────────────────────────────────

/**
 * Push a failed job to the retry queue or dead letter queue.
 * @param {Object} job
 * @param {Array}  retryQueue
 * @param {Array}  deadLetter
 * @param {string} reason - Why this job failed
 */
export function scheduleRetry(job, retryQueue, deadLetter, reason) {

  // Exhausted all attempts → dead letter
  if (job.attempts >= job.maxAttempts) {
    job.status = 'dead';
    deadLetter.push({ job, reason: `Exhausted after ${job.attempts} attempts. Last: ${reason}` });
    console.error(`✗ Job ${short(job.id)} dead after ${job.attempts} attempts`);
    return;
  }

  // Exponential backoff: attempt 1=2s, attempt 2=4s, attempt 3=8s
  const delayMs    = Math.pow(2, job.attempts) * 1000;
  job.nextRetryAt  = Date.now() + delayMs;
  job.status       = 'retrying';

  retryQueue.push(job);
  console.warn(
    `↻ Job ${short(job.id)} → retry queue ` +
    `(attempt ${job.attempts}/${job.maxAttempts}, wait ${delayMs / 1000}s, reason: ${reason})`
  );
}


// ─────────────────────────────────────────────────────────────
// startRetryWorker
// Background worker that polls the retry queue every second.
// When a job's nextRetryAt timestamp has passed, the worker
// removes it from the retry queue and re-adds it to a random
// main queue to be processed again.
// ─────────────────────────────────────────────────────────────

/**
 * Start the background retry worker.
 * @param {Array}    retryQueue  - Shared retry queue array
 * @param {PQueue[]} queues      - Main queue array to re-add jobs to
 * @param {Array}    results     - Shared results array
 * @param {Array}    deadLetter  - Shared dead letter array
 * @returns {NodeJS.Timeout} Timer handle — pass to clearInterval() to stop
 */
export function startRetryWorker(retryQueue, queues, results, deadLetter) {
  return setInterval(() => {
    const now   = Date.now();
    const ready = retryQueue.filter(j => j.nextRetryAt <= now);

    for (const job of ready) {
      // Remove from retry queue
      retryQueue.splice(retryQueue.indexOf(job), 1);

      // Re-add to a random main queue
      const queue = queues[Math.floor(Math.random() * queues.length)];
      queue.add(() => processJob(job, retryQueue, results, deadLetter));

      console.log(`↻ Job ${short(job.id)} back in queue for attempt ${job.attempts + 1}`);
    }
  }, 1000); // poll every 1 second
}


// ─────────────────────────────────────────────────────────────
// runRecommendationEngine
// Orchestrates the full system:
//   1. Wraps all leads in job envelopes
//   2. Creates parallel queues
//   3. Starts the retry worker
//   4. Distributes jobs round-robin
//   5. Waits for everything to finish
//   6. Returns results and reports failures
// ─────────────────────────────────────────────────────────────

/**
 * Run the full recommendation engine on an array of leads.
 * @param {Array}  allLeads    - Your full leads array
 * @param {number} numQueues   - Parallel queues to create (default 3)
 * @param {number} concurrency - Concurrent calls per queue (default 3)
 * @returns {Promise<Object>} { results, deadLetter }
 */
export async function runRecommendationEngine(
  allLeads,
  numQueues   = 3,
  concurrency = 3
) {
  const jobs       = allLeads.map(createJob);
  const queues     = Array.from({ length: numQueues }, () => new PQueue({ concurrency }));
  const results    = [];
  const retryQueue = [];
  const deadLetter = [];

  console.log(`Starting engine: ${jobs.length} jobs, ${numQueues} queues, concurrency ${concurrency}`);

  // Start background retry worker
  const retryTimer = startRetryWorker(retryQueue, queues, results, deadLetter);

  // Distribute all jobs across queues round-robin
  jobs.forEach((job, i) => {
    const queue = queues[i % numQueues];
    queue.add(() => processJob(job, retryQueue, results, deadLetter));
  });

  // Wait for all main queues to drain
  await Promise.all(queues.map(q => q.onIdle()));

  // Extra wait for any retries still in flight (max 30 seconds)
  await new Promise(r => setTimeout(r, 30_000));
  clearInterval(retryTimer);

  // Final report
  console.log('\n===== ENGINE REPORT =====');
  console.log(`✓ Succeeded:   ${results.length}`);
  console.log(`✗ Dead letter: ${deadLetter.length}`);

  if (deadLetter.length > 0) {
    console.error('Jobs requiring manual review:');
    deadLetter.forEach(({ job, reason }) => {
      console.error(`  Job ${short(job.id)} (lead ${job.payload.id}): ${reason}`);
    });
  }

  return { results, deadLetter };
}


// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

// Shortens a UUID for readable log output: "a3f9bc" not the full UUID
function short(id) {
  return id.slice(0, 6);
}

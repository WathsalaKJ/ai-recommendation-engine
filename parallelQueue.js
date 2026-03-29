// ─────────────────────────────────────────────────────────────
// prompt.js
// Builds the system prompt and user prompt for Claude.
//
// The system prompt defines Claude's role and the exact JSON
// format you want back. The user prompt contains your data
// and the specific question you are asking.
//
// Swap in your own data shape and question to use this for
// any business use case — leads, products, transactions, etc.
// ─────────────────────────────────────────────────────────────

/**
 * Build the prompt object for a leads recommendation request.
 * @param {Array} leads - Array of lead objects from your CRM or DB
 * @returns {{ system: string, user: string }}
 */
export function buildPrompt(leads) {

  // ── System prompt ──────────────────────────────────────────
  // Runs once per request. Defines Claude's persona and the
  // strict JSON output format your frontend expects.
  const system = `You are a senior sales analyst.
Analyze lead data and recommend which leads a sales rep
should prioritize today.

IMPORTANT: Reply ONLY with valid JSON. No explanation, no markdown,
no text outside the JSON block.

Use this exact format:
{
  "recommendations": [
    {
      "leadId": 1,
      "name": "Person Name",
      "priority": 1,
      "reason": "Plain English reason why this lead is the priority"
    }
  ],
  "summary": "One sentence overview of today's lead landscape"
}`;

  // ── User prompt ────────────────────────────────────────────
  // Changes with every call. Contains today's actual data
  // and the specific question you want answered.
  const user = `Here are today's leads:

${JSON.stringify(leads, null, 2)}

Rank the top 3 leads to contact today.
Consider: website visit frequency, email engagement,
deal size, days since last contact, and pipeline stage.`;

  return { system, user };
}


// ─────────────────────────────────────────────────────────────
// Bell curve variant — use this when your dashboard shows
// a performance distribution chart and you want AI insight
// on the shape of the curve automatically on page load.
// ─────────────────────────────────────────────────────────────

/**
 * Build a prompt for analysing a bell curve distribution.
 * @param {Object} stats - Bell curve stats computed from your chart data
 * @returns {{ system: string, user: string }}
 */
export function buildBellCurvePrompt(stats) {

  const system = `You are a senior data analyst specialising in
business performance distributions.

You are given bell curve statistics extracted from a dashboard chart.
Analyse the shape, skew, zone breakdown, and trend.
Identify what is unusual and recommend specific actions.

Reply ONLY with valid JSON in this exact format:
{
  "insight": "One sentence describing the curve shape",
  "concern": "The single biggest problem you see in this distribution",
  "recommendations": [
    { "action": "Specific thing to do", "reason": "Why this action" },
    { "action": "Specific thing to do", "reason": "Why this action" }
  ],
  "urgency": "low | medium | high"
}`;

  const user = `Here are the bell curve stats from our dashboard:

Metric: ${stats.metric}
Mean: ${stats.mean}  |  Std Dev: ${stats.stdDev}
Skew: ${stats.skew} (negative = left tail, positive = right tail)

Zone breakdown:
  Low zone:     ${stats.zones.low.pct}%  (${stats.zones.low.count} records)
  Average zone: ${stats.zones.average.pct}%  (${stats.zones.average.count} records)
  High zone:    ${stats.zones.high.pct}%  (${stats.zones.high.count} records)

Outliers: ${stats.outliers.low} extreme low, ${stats.outliers.high} extreme high
Trend vs last month: ${stats.comparedToLastMonth}
vs industry average: ${stats.comparedToIndustry}

What does this distribution tell us and what should we do?`;

  return { system, user };
}

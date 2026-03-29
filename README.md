# AI Recommendation Engine for Business Dashboards

A complete implementation of an LLM-powered recommendation engine
using the Claude API. No model training required.

Built as a companion to the Medium article:
👉 [How to Build an AI Recommendation Engine — link here]

## What's inside

| File | What it does |
|------|-------------|
| src/prompt.js | Builds the system + user prompt |
| src/api.js | Claude API call + retry logic |
| src/queue.js | Single queue with concurrency control |
| src/parallelQueue.js | Parallel queues for high volume |
| src/jobQueue.js | Full retry queue + dead letter queue |
| src/widget.jsx | React dashboard component |

## Quick start

1. Clone this repo
2. Run: npm install
3. Copy .env.example to .env and add your API key
4. Import any file and use it in your project

## Get your API key

Sign up at console.anthropic.com

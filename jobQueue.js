// ─────────────────────────────────────────────────────────────
// widget.jsx
// React component that displays AI recommendations on your
// dashboard. Handles three states automatically:
//
//   Loading  → skeleton loader (pulsing placeholder)
//   Error    → friendly error message, curve still visible
//   Success  → ranked recommendation cards with reasons
//
// Auto-loads on page mount — no button click needed.
// useEffect with [] fires once when the component mounts,
// just like the page opening triggers it automatically.
//
// Also includes:
//   InsightSkeleton  → pulsing placeholder while Claude thinks
//   BellCurveWidget  → variant for bell curve dashboard pages
//   insightCache     → prevents duplicate API calls on refresh
// ─────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';


// ─────────────────────────────────────────────────────────────
// RecommendationWidget
// Main widget for lead-based recommendation dashboards.
// Fires automatically when the component mounts.
// ─────────────────────────────────────────────────────────────

export function RecommendationWidget({ leads }) {
  const [recs,    setRecs]    = useState([]);
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // [] = runs once on mount — automatic, no click needed
  useEffect(() => {
    getRecommendations(leads)
      .then(result => {
        setRecs(result.recommendations);
        setSummary(result.summary);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <InsightSkeleton rows={3} />;

  if (error) return (
    <div className="insight-card insight-error">
      <p>Could not load recommendations. The chart data is still accurate.</p>
      <span className="error-detail">{error}</span>
    </div>
  );

  return (
    <div className="recommendation-panel">
      <div className="panel-header">
        <span className="ai-badge">AI</span>
        <h3>Top Leads to Contact Today</h3>
      </div>

      {summary && (
        <p className="summary">{summary}</p>
      )}

      {recs.map(r => (
        <div key={r.leadId} className="rec-card">
          <div className="rec-priority">#{r.priority}</div>
          <div className="rec-body">
            <span className="rec-name">{r.name}</span>
            <p className="rec-reason">{r.reason}</p>
          </div>
        </div>
      ))}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// BellCurveWidget
// Variant for report pages that show a bell curve chart.
// The curve renders immediately from your chart data.
// The AI insight loads in the background (1-3 seconds).
// Both happen automatically on page open — no click needed.
// ─────────────────────────────────────────────────────────────

export function BellCurveWidget({ curveStats }) {
  const [insight, setInsight] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Use cached result if available — avoids duplicate API calls
    getBellCurveInsightCached(curveStats)
      .then(result => {
        setInsight(result);
        setLoading(false);
      })
      .catch(() => {
        // Fail silently — the chart itself is still useful
        setLoading(false);
      });
  }, []);

  if (loading) return <InsightSkeleton rows={2} />;
  if (!insight) return null;

  const urgencyColors = {
    low:    'border-green-400',
    medium: 'border-amber-400',
    high:   'border-red-500'
  };

  return (
    <div className={`insight-card ${urgencyColors[insight.urgency] || ''}`}>

      <div className="insight-header">
        <span className="ai-badge">AI Insight</span>
        <span className={`urgency-badge urgency-${insight.urgency}`}>
          {insight.urgency} urgency
        </span>
      </div>

      <p className="insight-text">{insight.insight}</p>

      <div className="concern-box">
        <strong>Key concern:</strong> {insight.concern}
      </div>

      <div className="recommendations">
        <strong>Recommended actions</strong>
        {insight.recommendations.map((rec, i) => (
          <div key={i} className="rec-item">
            <span className="rec-action">{rec.action}</span>
            <span className="rec-reason">{rec.reason}</span>
          </div>
        ))}
      </div>

    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// InsightSkeleton
// Pulsing grey placeholder shown while Claude is thinking.
// Matches the shape of the real card so the layout does not
// jump when the content arrives.
// ─────────────────────────────────────────────────────────────

export function InsightSkeleton({ rows = 2 }) {
  return (
    <div className="insight-card skeleton-card">

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
        <div className="skeleton" style={{ width: '32px', height: '20px', borderRadius: '4px' }} />
        <div className="skeleton" style={{ width: '180px', height: '16px' }} />
      </div>

      {/* Summary line */}
      <div className="skeleton" style={{ width: '100%', height: '14px', marginBottom: '6px' }} />
      <div className="skeleton" style={{ width: '75%',  height: '14px', marginBottom: '18px' }} />

      {/* Recommendation rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
          <div className="skeleton" style={{ width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton" style={{ width: '60%',  height: '14px', marginBottom: '5px' }} />
            <div className="skeleton" style={{ width: '100%', height: '12px' }} />
          </div>
        </div>
      ))}

    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// insightCache
// Prevents duplicate Claude API calls when a user refreshes
// the page or navigates away and back within the TTL window.
//
// Cache key = mean + stdDev + skew (the numbers that define
// the curve shape). If these haven't changed, the insight
// hasn't changed either — no need to call Claude again.
// ─────────────────────────────────────────────────────────────

const insightCache  = new Map();
const CACHE_TTL_MS  = 10 * 60 * 1000; // 10 minutes

/**
 * Get bell curve insight with caching.
 * First visit: calls Claude (~1-3 seconds)
 * Repeat visit within TTL: returns cache instantly (0ms)
 * After TTL expires: calls Claude again for fresh insight
 */
async function getBellCurveInsightCached(stats) {
  const cacheKey = `${stats.mean}-${stats.stdDev}-${stats.skew}`;
  const cached   = insightCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log('Returning cached bell curve insight');
    return cached.data;
  }

  // Cache miss — fetch from API (imported from api.js in your project)
  const response = await fetch('/api/bell-curve-insight', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(stats)
  });

  const insight = await response.json();

  insightCache.set(cacheKey, {
    data:      insight,
    timestamp: Date.now()
  });

  return insight;
}


// ─────────────────────────────────────────────────────────────
// CSS to add to your stylesheet
// ─────────────────────────────────────────────────────────────
//
// .skeleton {
//   background: #e5e7eb;
//   border-radius: 4px;
//   animation: skeleton-pulse 1.5s ease-in-out infinite;
// }
//
// @keyframes skeleton-pulse {
//   0%, 100% { opacity: 1; }
//   50%       { opacity: 0.4; }
// }
//
// .ai-badge {
//   background: #ede9fe;
//   color: #5b21b6;
//   font-size: 11px;
//   font-weight: 600;
//   padding: 2px 8px;
//   border-radius: 10px;
// }
//
// .rec-card {
//   display: flex;
//   gap: 12px;
//   padding: 12px;
//   border: 1px solid #e5e7eb;
//   border-radius: 8px;
//   margin-bottom: 8px;
// }
//
// .urgency-low    { color: #166534; background: #dcfce7; }
// .urgency-medium { color: #92400e; background: #fef3c7; }
// .urgency-high   { color: #991b1b; background: #fee2e2; }

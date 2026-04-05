/**
 * Movement detection and scoring engine.
 * Ported from SerpDelta AlertService + AlertScorer (PHP → TS).
 */

export interface Snapshot {
  siteUrl: string;
  date: string;
  type: "page" | "query";
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface Movement {
  siteUrl: string;
  date: string;
  kind: "page" | "query";
  value: string;
  currentPosition: number;
  baselinePosition: number;
  deltaPosition: number;
  currentClicks: number;
  baselineClicks: number;
  deltaClicks: number;
  currentImpressions: number;
  baselineImpressions: number;
  deltaImpressions: number;
  score: number;
  direction: "up" | "down";
}

// --- Config constants (from config/alerts.php + config/gsc.php) ---

const SYNC_LOOKBACK = 3;
const COMPARISON_DAYS = 7;
const MIN_IMPRESSIONS = 10;
const MIN_CLICKS = 1;
const MIN_DELTA = 0.5;
const ALERT_THRESHOLD = 50;
const TRACKED_BONUS = 15;
const MIN_HISTORY_FOR_ZSCORE = 14;
const MIN_STDDEV = 1.0;

const STATISTICAL_TIERS = [
  { minZ: 4.0, points: 55 },
  { minZ: 3.0, points: 45 },
  { minZ: 2.5, points: 35 },
  { minZ: 2.0, points: 25 },
  { minZ: 1.5, points: 15 },
];

const POSITION_BRACKETS: Record<string, Array<{ minDelta: number; points: number }>> = {
  top_4:     [{ minDelta: 3, points: 30 }, { minDelta: 2, points: 20 }],
  top_10:    [{ minDelta: 3, points: 30 }, { minDelta: 2, points: 25 }, { minDelta: 1, points: 10 }],
  page_2:    [{ minDelta: 7, points: 25 }, { minDelta: 5, points: 20 }, { minDelta: 3, points: 10 }],
  deep:      [{ minDelta: 15, points: 20 }, { minDelta: 10, points: 15 }],
  very_deep: [{ minDelta: 30, points: 15 }, { minDelta: 20, points: 10 }],
};

const TRAFFIC_TIERS = [
  { minChange: 0.50, points: 25 },
  { minChange: 0.30, points: 15 },
  { minChange: 0.20, points: 10 },
];

// --- Helpers ---

function round(n: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

function getBracket(position: number): string {
  if (position <= 4) return "top_4";
  if (position <= 10) return "top_10";
  if (position <= 20) return "page_2";
  if (position <= 50) return "deep";
  return "very_deep";
}

// --- Scoring ---

function scoreStatistical(
  delta: number,
  history: number[],
): { zScore: number; points: number } {
  if (history.length < MIN_HISTORY_FOR_ZSCORE) {
    const zScore = Math.abs(delta) >= 5 ? 1.5 : 0;
    const tier = STATISTICAL_TIERS.find((t) => zScore >= t.minZ);
    return { zScore, points: tier?.points ?? 0 };
  }

  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const variance = history.reduce((a, x) => a + (x - mean) ** 2, 0) / history.length;
  const stddev = Math.max(Math.sqrt(variance), MIN_STDDEV);
  const zScore = Math.abs(delta) / stddev;

  const tier = STATISTICAL_TIERS.find((t) => zScore >= t.minZ);
  return { zScore: round(zScore, 2), points: tier?.points ?? 0 };
}

function scorePosition(currentPos: number, baselinePos: number, delta: number): number {
  const relevantPos = Math.min(currentPos, baselinePos);
  const bracket = getBracket(relevantPos);
  const thresholds = POSITION_BRACKETS[bracket] || [];
  const absDelta = Math.abs(delta);

  for (const t of thresholds) {
    if (absDelta >= t.minDelta) return t.points;
  }
  return 0;
}

function scoreTraffic(currentClicks: number, baselineClicks: number): number {
  if (baselineClicks < 5) return 0;
  const changePct = Math.abs((currentClicks - baselineClicks) / baselineClicks);
  for (const t of TRAFFIC_TIERS) {
    if (changePct >= t.minChange) return t.points;
  }
  return 0;
}

export function scoreShift(
  delta: number,
  currentPos: number,
  baselinePos: number,
  currentClicks: number,
  baselineClicks: number,
  impressions: number,
  history: number[],
  isTracked: boolean,
): number {
  if (impressions < MIN_IMPRESSIONS) return 0;
  if (currentClicks < MIN_CLICKS && baselineClicks < MIN_CLICKS) return 0;
  if (Math.abs(delta) < MIN_DELTA) return 0;

  const stat = scoreStatistical(delta, history);
  const pos = scorePosition(currentPos, baselinePos, delta);
  const traffic = scoreTraffic(currentClicks, baselineClicks);
  const tracked = isTracked ? TRACKED_BONUS : 0;

  return stat.points + pos + traffic + tracked;
}

// --- Movement Detection ---

interface AggregatedItem {
  position: number;
  clicks: number;
  impressions: number;
  count: number;
}

function aggregateSnapshots(
  snapshots: Snapshot[],
  startDate: string,
  endDate: string,
): Map<string, AggregatedItem> {
  const map = new Map<string, AggregatedItem>();

  for (const s of snapshots) {
    if (s.date < startDate || s.date > endDate) continue;
    const key = `${s.type}:${s.key}`;
    const existing = map.get(key);
    if (existing) {
      existing.position = (existing.position * existing.count + s.position) / (existing.count + 1);
      existing.clicks += s.clicks;
      existing.impressions += s.impressions;
      existing.count += 1;
    } else {
      map.set(key, {
        position: s.position,
        clicks: s.clicks,
        impressions: s.impressions,
        count: 1,
      });
    }
  }
  return map;
}

function getHistoryForItem(
  snapshots: Snapshot[],
  type: string,
  value: string,
): number[] {
  return snapshots
    .filter((s) => s.type === type && s.key === value)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => s.position);
}

export function detectMovements(
  snapshots: Snapshot[],
  siteUrl: string,
  trackedItems: Set<string>,
): Movement[] {
  // Build date boundaries
  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() - SYNC_LOOKBACK);

  const midDate = new Date(endDate);
  midDate.setDate(midDate.getDate() - COMPARISON_DAYS);

  const startDate = new Date(midDate);
  startDate.setDate(startDate.getDate() - COMPARISON_DAYS);

  const endStr = endDate.toISOString().slice(0, 10);
  const midStr = midDate.toISOString().slice(0, 10);
  const startStr = startDate.toISOString().slice(0, 10);

  const current = aggregateSnapshots(snapshots, midStr, endStr);
  const previous = aggregateSnapshots(snapshots, startStr, midStr);

  const movements: Movement[] = [];

  for (const [compositeKey, cur] of current) {
    const prev = previous.get(compositeKey);
    if (!prev) continue;

    const [kind, value] = [
      compositeKey.split(":")[0] as "page" | "query",
      compositeKey.slice(compositeKey.indexOf(":") + 1),
    ];

    const delta = round(prev.position - cur.position, 1); // Positive = improved
    if (Math.abs(delta) < MIN_DELTA) continue;

    const history = getHistoryForItem(snapshots, kind, value);
    const isTracked = trackedItems.has(compositeKey);

    const score = scoreShift(
      delta,
      cur.position,
      prev.position,
      cur.clicks,
      prev.clicks,
      cur.impressions,
      history,
      isTracked,
    );

    movements.push({
      siteUrl,
      date: endStr,
      kind,
      value,
      currentPosition: round(cur.position, 1),
      baselinePosition: round(prev.position, 1),
      deltaPosition: delta,
      currentClicks: cur.clicks,
      baselineClicks: prev.clicks,
      deltaClicks: cur.clicks - prev.clicks,
      currentImpressions: cur.impressions,
      baselineImpressions: prev.impressions,
      deltaImpressions: cur.impressions - prev.impressions,
      score,
      direction: delta > 0 ? "up" : "down",
    });
  }

  // Sort by score descending, then magnitude
  movements.sort((a, b) => b.score - a.score || Math.abs(b.deltaPosition) - Math.abs(a.deltaPosition));
  return movements;
}

export { ALERT_THRESHOLD };

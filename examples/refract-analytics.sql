-- refract-analytics.sql
-- Pre-built DuckDB views for Refract event streams.
-- Reads events.jsonl in the working directory, as written by
--   refract export "Page" --format ndjson > events.jsonl
-- Load with: duckdb -c ".read examples/refract-analytics.sql"
-- Then query: SELECT * FROM contested_claims;
-- Column names are the event's own keys (eventType, toRevisionId), so they
-- are quoted to keep their case in results.

-- Sentences that were modified, removed or reintroduced after they appeared.
-- Events carry no claim identifier, so a sentence is keyed by its section and
-- text: a reworded sentence starts a new row under its new text.
CREATE OR REPLACE VIEW contested_claims AS
SELECT
  section,
  CASE WHEN after <> '' THEN after ELSE before END AS claim_text,
  min(timestamp) AS first_seen,
  max(timestamp) AS last_seen,
  count(*) FILTER (WHERE "eventType" = 'sentence_modified') AS modifications,
  count(*) FILTER (WHERE "eventType" = 'sentence_removed') AS removals,
  count(*) FILTER (WHERE "eventType" = 'sentence_reintroduced') AS reintroductions,
  modifications + removals + reintroductions AS contestation_score
FROM read_json_auto('events.jsonl')
WHERE "eventType" LIKE 'sentence_%'
GROUP BY section, claim_text
HAVING contestation_score > 0
ORDER BY contestation_score DESC;

-- Citation activity aggregated by month.
-- Months with more removals than additions indicate net citation loss.
CREATE OR REPLACE VIEW citation_churn_by_month AS
SELECT
  strftime(timestamp, '%Y-%m') AS month,
  count(*) FILTER (WHERE "eventType" = 'citation_added') AS added,
  count(*) FILTER (WHERE "eventType" = 'citation_removed') AS removed,
  count(*) FILTER (WHERE "eventType" = 'citation_replaced') AS replaced,
  added + removed + replaced AS total_churn
FROM read_json_auto('events.jsonl')
WHERE "eventType" LIKE 'citation_%'
GROUP BY month
ORDER BY month;

-- Sections ranked by activity.
-- revert_detected and edit_cluster_detected describe a whole revision, so
-- their section is the empty string and they are counted on that row.
CREATE OR REPLACE VIEW section_activity AS
SELECT
  section,
  count(*) AS total_events,
  count(*) FILTER (WHERE "eventType" = 'revert_detected') AS reverts,
  count(*) FILTER (WHERE "eventType" LIKE 'citation_%') AS citation_events,
  count(*) FILTER (WHERE "eventType" LIKE 'talk_%') AS talk_events,
  count(*) FILTER (WHERE "eventType" = 'edit_cluster_detected') AS clusters,
  count(*) FILTER (WHERE "eventType" LIKE 'sentence_%') AS sentence_events
FROM read_json_auto('events.jsonl')
GROUP BY section
ORDER BY total_events DESC;

-- Event type distribution.
CREATE OR REPLACE VIEW event_type_distribution AS
SELECT
  "eventType",
  count(*) AS count,
  round(count(*) * 100.0 / sum(count(*)) OVER (), 1) AS pct
FROM read_json_auto('events.jsonl')
GROUP BY "eventType"
ORDER BY count DESC;

-- Talk-to-content ratio for the file.
-- Low ratio + high reverts = edit warring. High ratio = active deliberation.
CREATE OR REPLACE VIEW talk_content_ratio AS
SELECT
  count(*) FILTER (WHERE "eventType" LIKE 'talk_%') AS talk_events,
  count(*) FILTER (WHERE "eventType" LIKE 'sentence_%' OR "eventType" = 'revert_detected') AS content_events,
  count(*) FILTER (WHERE "eventType" = 'revert_detected') AS reverts,
  CASE
    WHEN content_events > 0 THEN round(talk_events * 100.0 / content_events, 1)
    ELSE 0
  END AS talk_pct
FROM read_json_auto('events.jsonl');

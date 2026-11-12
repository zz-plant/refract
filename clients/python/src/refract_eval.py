"""
refract_eval — map Refract events to model evaluation records.

Usage:
    from refract_eval import build_leakage_benchmark, check_provenance

    records = build_leakage_benchmark("events.jsonl", cutoff="2024-06-01")
    # → [{"claim": "...", "first_seen": "...", "leaked": True}, ...]

    result = check_provenance("events.jsonl", "who.int")
    # → {"verified": 3, "outdated": 1, "hallucinated": 0}
"""

import json
from datetime import datetime, timezone
from dataclasses import dataclass, field
from typing import Optional


def _parse_time(value: str) -> datetime:
    """Parse an ISO 8601 date or timestamp; one without an offset is read as UTC.

    Event timestamps end in "Z" and a cutoff is usually a bare date, and Python
    refuses to compare an aware datetime with a naive one.
    """
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


@dataclass
class LeakageRecord:
    claim_text: str
    first_seen: str
    revision_id: int
    cutoff: str
    leaked: bool
    event_id: Optional[str] = None


@dataclass
class ProvenanceCheck:
    source_pattern: str
    verified: int = 0
    outdated: int = 0
    hallucinated: int = 0
    events: list = field(default_factory=list)


def build_leakage_benchmark(
    events_path: str,
    cutoff: str,
    min_claim_length: int = 20,
) -> list[LeakageRecord]:
    cutoff_dt = _parse_time(cutoff)
    events = _load_events(events_path)
    records = []

    for event in events:
        if event.get("eventType") != "sentence_first_seen":
            continue
        after = event.get("after", "")
        if len(after) < min_claim_length:
            continue

        ts = _parse_time(event["timestamp"])
        records.append(LeakageRecord(
            claim_text=after,
            first_seen=event["timestamp"],
            revision_id=event.get("toRevisionId", 0),
            cutoff=cutoff,
            leaked=ts > cutoff_dt,
            event_id=event.get("eventId"),
        ))

    return records


def build_recency_benchmark(
    events_path: str,
    knowledge_date: str,
) -> dict:
    events = _load_events(events_path)
    kd = _parse_time(knowledge_date)

    claims_at_date = []
    claims_missing = []

    for event in events:
        if event.get("eventType") not in ("sentence_first_seen", "sentence_modified", "sentence_reintroduced"):
            continue
        ts = _parse_time(event["timestamp"])
        if ts <= kd:
            claims_at_date.append(event.get("after", ""))
        else:
            claims_missing.append({
                "claim": event.get("after", ""),
                "appeared": event["timestamp"],
            })

    return {
        "knowledge_date": knowledge_date,
        "claims_known": len(claims_at_date),
        "claims_not_yet_known": len(claims_missing),
        "known_claims": claims_at_date[:50],
        "not_yet_known": claims_missing[:50],
    }


def check_provenance(
    events_path: str,
    source_pattern: str,
) -> ProvenanceCheck:
    events = _load_events(events_path)
    result = ProvenanceCheck(source_pattern=source_pattern)

    for event in events:
        if event.get("eventType") not in ("citation_added", "citation_removed", "citation_replaced"):
            continue
        before = event.get("before", "")
        after = event.get("after", "")
        if source_pattern not in before and source_pattern not in after:
            continue

        if event["eventType"] == "citation_added":
            result.verified += 1
        elif event["eventType"] == "citation_removed":
            result.outdated += 1
        elif event["eventType"] == "citation_replaced":
            result.outdated += 1

        result.events.append({
            "type": event["eventType"],
            "timestamp": event.get("timestamp"),
            "before": before[:200],
            "after": after[:200],
        })

    return result


def score_retrieval_quality(
    events_path: str,
    retrieved_passages: list[str],
) -> list[dict]:
    events = _load_events(events_path)
    scores = []

    for passage in retrieved_passages:
        matches = [e for e in events if passage[:50] in e.get("after", "")]
        if not matches:
            scores.append({"passage": passage[:100], "score": None, "found": False})
            continue

        reverts = sum(1 for e in matches if e.get("eventType") == "revert_detected")
        citations = sum(1 for e in matches if e.get("eventType", "").startswith("citation_"))
        talk = sum(1 for e in matches if e.get("eventType", "").startswith("talk_"))

        stability = 1.0 - min(1.0, (reverts * 0.4 + citations * 0.1 + talk * 0.05))
        scores.append({
            "passage": passage[:100],
            "score": round(stability, 3),
            "reverts": reverts,
            "citation_churn": citations,
            "talk_activity": talk,
            "found": True,
        })

    return scores


def _load_events(path: str) -> list[dict]:
    events = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                events.append(json.loads(line))
    return events

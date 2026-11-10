"""
Python SDK for Refract — wraps the Refract CLI via subprocess.
"""

import json
import os
import shutil
import subprocess
from dataclasses import dataclass, field
from typing import Any

__all__ = [
    "Refract",
    "EvidenceEvent",
    "DeterministicFact",
    "FactProvenance",
    "compute_survival_records",
    "to_networkx",
]


@dataclass
class FactProvenance:
    analyzer: str | None = None
    version: str | None = None
    inputHashes: list[str] | None = None
    parameters: dict[str, Any] | None = None


@dataclass
class DeterministicFact:
    fact: str = ""
    detail: str | None = None
    provenance: FactProvenance | None = None


@dataclass
class EvidenceEvent:
    schemaVersion: str | None = None
    eventId: str | None = None
    eventType: str = ""
    fromRevisionId: int = 0
    toRevisionId: int = 0
    section: str = ""
    before: str = ""
    after: str = ""
    deterministicFacts: list[DeterministicFact] = field(default_factory=list)
    modelInterpretation: dict | None = None
    layer: str = ""
    timestamp: str = ""


def _parse_event(obj: dict) -> EvidenceEvent:
    facts = []
    for f in obj.get("deterministicFacts", []):
        prov = f.get("provenance")
        provenance = FactProvenance(
            analyzer=prov.get("analyzer") if prov else None,
            version=prov.get("version") if prov else None,
            inputHashes=prov.get("inputHashes") if prov else None,
            parameters=prov.get("parameters") if prov else None,
        ) if prov else None
        facts.append(DeterministicFact(
            fact=f.get("fact", ""),
            detail=f.get("detail"),
            provenance=provenance,
        ))
    return EvidenceEvent(
        schemaVersion=obj.get("schemaVersion"),
        eventId=obj.get("eventId"),
        eventType=obj.get("eventType", ""),
        fromRevisionId=obj.get("fromRevisionId", 0),
        toRevisionId=obj.get("toRevisionId", 0),
        section=obj.get("section", ""),
        before=obj.get("before", ""),
        after=obj.get("after", ""),
        deterministicFacts=facts,
        modelInterpretation=obj.get("modelInterpretation"),
        layer=obj.get("layer", ""),
        timestamp=obj.get("timestamp", ""),
    )


def _flatten_event(e: EvidenceEvent) -> dict[str, Any]:
    fact = e.deterministicFacts[0] if e.deterministicFacts else None
    return {
        "timestamp": e.timestamp,
        "event_type": e.eventType,
        "from_revision_id": e.fromRevisionId,
        "to_revision_id": e.toRevisionId,
        "section": e.section,
        "event_id": e.eventId or "",
        "schema_version": e.schemaVersion or "",
        "layer": e.layer,
        "fact": fact.fact if fact else "",
        "fact_detail": fact.detail if fact else "",
        "analyzer_name": fact.provenance.analyzer if fact and fact.provenance else "",
        "analyzer_version": fact.provenance.version if fact and fact.provenance else "",
    }


def compute_survival_records(events: list[EvidenceEvent]) -> list[dict[str, Any]]:
    """Turn sentence events into time-to-event records for survival analysis.

    One record per span from sentence_first_seen or sentence_reintroduced to
    sentence_removed, matched on section and the first 60 characters of the
    sentence. A span with no removal is right-censored (event_observed 0).
    """
    from datetime import datetime
    records = []
    first_seen: dict[str, str] = {}
    for e in sorted(events, key=lambda x: x.timestamp or ""):
        key = (e.section or "") + "::" + (e.after or e.before)[:60]
        if e.eventType in ("sentence_first_seen", "sentence_reintroduced"):
            first_seen[key] = e.timestamp
        elif e.eventType == "sentence_removed" and key in first_seen:
            start_ts = first_seen.pop(key)
            duration_days = None
            if start_ts and e.timestamp:
                try:
                    t0 = datetime.fromisoformat(start_ts.replace("Z", "+00:00"))
                    t1 = datetime.fromisoformat(e.timestamp.replace("Z", "+00:00"))
                    duration_days = max(0.0, (t1 - t0).total_seconds() / 86400.0)
                except Exception:
                    pass
            records.append({
                "statement_key": key,
                "section": e.section,
                "start_time": start_ts,
                "end_time": e.timestamp,
                "duration_days": duration_days,
                "event_observed": 1,
            })
    for key, start_ts in first_seen.items():
        records.append({
            "statement_key": key,
            "section": key.split("::")[0],
            "start_time": start_ts,
            "end_time": None,
            "duration_days": None,
            "event_observed": 0,
        })
    return records


def to_networkx(events: list[EvidenceEvent]) -> Any:
    """Build a NetworkX DiGraph of the revision transitions in events.

    Each event adds an edge rev:<fromRevisionId> -> rev:<toRevisionId> carrying
    its eventType and timestamp; a later event on the same pair overwrites them.
    A fact whose detail contains "url=" also adds a "cites" edge from the
    revision to that detail. No analyzer emits a citation URL as a fact, but at
    forensic depth the full_wikitext_before/after facts contain "url=" whenever
    the page cites a web source, and each becomes a node holding a revision's
    whole wikitext. Pass brief or detailed events for a graph of transitions.
    """
    import networkx as nx  # type: ignore
    G = nx.DiGraph()
    for e in events:
        if e.fromRevisionId and e.toRevisionId:
            G.add_edge(f"rev:{e.fromRevisionId}", f"rev:{e.toRevisionId}", eventType=e.eventType, timestamp=e.timestamp)
        for fact in e.deterministicFacts:
            if fact.detail and "url=" in fact.detail:
                G.add_edge(f"rev:{e.toRevisionId}", fact.detail, relation="cites")
    return G


class RefractError(Exception):
    """Raised when the Refract CLI returns a non-zero exit code."""
    pass


class Refract:
    """Python SDK for Refract.

    Wraps the `refract` CLI via subprocess. Requires the Refract CLI to be
    installed (``npm install -g @refract-org/cli``).

    Args:
        binary: Path to the ``refract`` binary. If None, searches PATH for
            ``refract`` then falls back to ``npx @refract-org/cli``.
    """

    def __init__(self, binary: str | None = None):
        self._binary = self._find_binary(binary)

    @staticmethod
    def _find_binary(preferred: str | None) -> str:
        if preferred and (shutil.which(preferred) or os.path.exists(preferred)):
            return preferred
        if shutil.which("refract"):
            return "refract"
        if shutil.which("npx"):
            return "npx"
        if shutil.which("node"):
            return "npx"
        raise RefractError(
            "The Refract CLI is required but not found.\n"
            "Install it: npm install -g @refract-org/cli\n"
            "Or ensure Node.js is installed: https://nodejs.org"
        )

    def _run(self, args: list[str]) -> str:
        cmd = [self._binary, *args]
        if self._binary == "npx":
            cmd = ["npx", "@refract-org/cli", *args]
        elif self._binary.endswith(".js"):
            cmd = ["node", self._binary, *args]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        except FileNotFoundError:
            raise RefractError(
                "The Refract CLI is required but not found.\n"
                "Install it: npm install -g @refract-org/cli\n"
                "Or ensure Node.js is installed: https://nodejs.org\n"
                "Docs: https://zz-plant.github.io/refract/install/"
            )
        if result.returncode != 0:
            raise RefractError(
                f"refract CLI exited with code {result.returncode}: {result.stderr.strip()}"
            )
        return result.stdout

    def analyze(
        self,
        page: str,
        depth: str = "brief",
        as_frame: bool = False,
        as_polars: bool = False,
        **kwargs: str,
    ) -> list[EvidenceEvent] | Any:
        """Analyze a Wikipedia page.

        Args:
            page: Page title.
            depth: Analysis depth (brief, detailed, forensic).
            as_frame: If True, return a pandas DataFrame (requires pandas).
            as_polars: If True, return a polars DataFrame (requires polars).
            **kwargs: Additional CLI flags (api, since, etc.).

        Returns:
            List of EvidenceEvent objects, or a DataFrame if as_frame/as_polars=True.
        """
        args = ["analyze", page, "--depth", depth, "--json"]
        for k, v in kwargs.items():
            args.extend([f"--{k.replace('_', '-')}", v])
        stdout = self._run(args)
        # Parse NDJSON output
        events = []
        for line in stdout.strip().split("\n"):
            if line:
                events.append(_parse_event(json.loads(line)))
        if as_polars:
            import polars as pl  # type: ignore
            return pl.DataFrame([_flatten_event(e) for e in events])
        if as_frame:
            import pandas as pd  # type: ignore
            return pd.DataFrame([_flatten_event(e) for e in events])
        return events

    def export(
        self,
        page: str,
        format: str = "ndjson",
        flatten: bool = False,
        as_frame: bool = False,
        as_polars: bool = False,
        **kwargs: str,
    ) -> list[EvidenceEvent] | Any:
        """Export analysis results.

        Args:
            page: Page title.
            format: Output format (json, csv, ndjson).
            flatten: Flatten nested fields (for CSV).
            as_frame: If True, return a pandas DataFrame.
            as_polars: If True, return a polars DataFrame.
            **kwargs: Additional CLI flags.

        Returns:
            List of EvidenceEvent objects, or a DataFrame if as_frame/as_polars=True.
        """
        args = ["export", page, "--format", format]
        if flatten:
            args.append("--flatten")
        for k, v in kwargs.items():
            args.extend([f"--{k.replace('_', '-')}", v])
        stdout = self._run(args)
        if format == "ndjson":
            events = []
            for line in stdout.strip().split("\n"):
                if line:
                    events.append(_parse_event(json.loads(line)))
            if as_polars:
                import polars as pl  # type: ignore
                return pl.DataFrame([_flatten_event(e) for e in events])
            if as_frame:
                import pandas as pd
                return pd.DataFrame([_flatten_event(e) for e in events])
            return events
        return stdout

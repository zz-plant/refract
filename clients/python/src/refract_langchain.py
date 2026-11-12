"""
LangChain document loader for Refract.

Loads Refract events as LangChain Documents, where each event becomes a
Document with the event text as content and stability metadata in metadata.

Requires: refract-py, langchain-core

Usage:
    from refract_langchain import RefractLoader

    loader = RefractLoader(page="Bitcoin", depth="forensic")
    docs = loader.load()

    for doc in docs:
        print(doc.page_content[:100], doc.metadata["event_type"], doc.metadata["stability_score"])
"""

from typing import Any, Iterator, Optional

from langchain_core.documents import Document
from langchain_core.document_loaders import BaseLoader
from refract import Refract


def _value(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _first_fact(event: Any) -> Any:
    facts = _value(event, "deterministicFacts", []) or []
    return facts[0] if facts else None


class RefractLoader(BaseLoader):
    """Load Refract analysis results as LangChain Documents.

    Each event becomes a Document. The event text (before/after) is the
    page content. Provenance metadata (event type, revision range, analyzer
    name/version, schema version) is stored in metadata.

    Args:
        page: Wikipedia page title.
        depth: Analysis depth (brief, detailed, forensic).
        api_url: MediaWiki API URL (default: English Wikipedia).
        min_stability: Minimum stability score (0-1) to include. The score
            is set by event type: removed sentences 0.0, reverts and edit
            clusters 0.2, modified sentences 0.5, first-seen sentences 0.9,
            everything else 0.8. Default 0 (include all).
    """

    def __init__(
        self,
        page: str,
        depth: str = "detailed",
        api_url: Optional[str] = None,
        min_stability: float = 0.0,
    ):
        self.page = page
        self.depth = depth
        self.api_url = api_url
        self.min_stability = min_stability
        self._client = Refract()

    def _compute_stability(self, events: list) -> dict[str, float]:
        scores: dict[str, list[float]] = {}
        for e in events:
            cid = _value(e, "claimId") or _value(e, "eventType", "") + "_" + str(_value(e, "toRevisionId", 0))
            scores.setdefault(cid, [])
            base = 0.8
            event_type = _value(e, "eventType")
            if event_type in ("revert_detected", "edit_cluster_detected"):
                base = 0.2
            elif event_type == "sentence_removed":
                base = 0.0
            elif event_type == "sentence_modified":
                base = 0.5
            elif event_type == "sentence_first_seen":
                base = 0.9
            scores[cid].append(base)
        return {cid: sum(v) / len(v) for cid, v in scores.items()}

    def lazy_load(self) -> Iterator[Document]:
        # analyze, not export: the CLI's export is fixed at detailed depth, so the
        # depth argument had no effect, and api_url was never passed on at all.
        flags = {"api": self.api_url} if self.api_url else {}
        events = self._client.analyze(self.page, depth=self.depth, **flags)
        stability = self._compute_stability(events)

        for e in events:
            fact = _first_fact(e)
            provenance = _value(fact, "provenance", {}) or {}
            cid = _value(e, "claimId") or _value(e, "eventType", "") + "_" + str(_value(e, "toRevisionId", 0))
            score = stability.get(cid, 0.5)
            if score < self.min_stability:
                continue

            content = _value(e, "after") or _value(e, "before") or _value(e, "eventType", "")
            metadata = {
                "source": f"wikipedia/{self.page}",
                "event_type": _value(e, "eventType"),
                "from_revision_id": _value(e, "fromRevisionId"),
                "to_revision_id": _value(e, "toRevisionId"),
                "section": _value(e, "section", ""),
                "timestamp": _value(e, "timestamp"),
                "schema_version": _value(e, "schemaVersion"),
                "analyzer": _value(provenance, "analyzer"),
                "analyzer_version": _value(provenance, "version"),
                "stability_score": round(score, 3),
                "layer": _value(e, "layer"),
                "claim_id": cid,
            }
            yield Document(page_content=content, metadata=metadata)

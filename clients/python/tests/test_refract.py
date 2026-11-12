"""Tests for refract-py."""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from refract import (
    Refract,
    RefractError,
    EvidenceEvent,
    DeterministicFact,
    FactProvenance,
)


# ── Dataclass construction ──────────────────────────────────────────

def test_fact_provenance_defaults():
    """FactProvenance with no args has None fields."""
    fp = FactProvenance()
    assert fp.analyzer is None
    assert fp.version is None
    assert fp.inputHashes is None
    assert fp.parameters is None


def test_fact_provenance_full():
    """FactProvenance with all fields set."""
    fp = FactProvenance(
        analyzer="section-differ",
        version="0.4.0",
        inputHashes=["abc123"],
        parameters={"similarityThreshold": 0.8},
    )
    assert fp.analyzer == "section-differ"
    assert fp.version == "0.4.0"
    assert fp.inputHashes == ["abc123"]
    assert fp.parameters == {"similarityThreshold": 0.8}


def test_deterministic_fact_defaults():
    """DeterministicFact with no args has empty fact, None detail/provenance."""
    df = DeterministicFact()
    assert df.fact == ""
    assert df.detail is None
    assert df.provenance is None


def test_deterministic_fact_with_provenance():
    """DeterministicFact wraps a FactProvenance."""
    fp = FactProvenance(analyzer="citation-tracker", version="0.4.0")
    df = DeterministicFact(fact="citation_changed", detail="type=added", provenance=fp)
    assert df.fact == "citation_changed"
    assert df.detail == "type=added"
    assert df.provenance.analyzer == "citation-tracker"


def test_evidence_event_defaults():
    """EvidenceEvent has sensible defaults for optional fields."""
    ev = EvidenceEvent()
    assert ev.eventType == ""
    assert ev.fromRevisionId == 0
    assert ev.schemaVersion is None
    assert ev.eventId is None
    assert ev.deterministicFacts == []
    assert ev.modelInterpretation is None


# ── _parse_event ─────────────────────────────────────────────────────

def test_parse_event():
    """Test that a raw dict is correctly parsed into typed objects."""
    raw = {
        "eventType": "revert_detected",
        "schemaVersion": "0.4.0",
        "fromRevisionId": 100,
        "toRevisionId": 101,
        "section": "",
        "before": "",
        "after": "revert vandalism",
        "timestamp": "2026-01-01T00:00:00Z",
        "layer": "observed",
        "deterministicFacts": [
            {
                "fact": "revert_detected",
                "detail": "comment=revert vandalism",
                "provenance": {
                    "analyzer": "revert-detector",
                    "version": "0.4.0",
                    "inputHashes": [],
                },
            }
        ],
    }
    from refract import _parse_event
    event = _parse_event(raw)
    assert event.eventType == "revert_detected"
    assert event.schemaVersion == "0.4.0"
    assert event.fromRevisionId == 100
    assert len(event.deterministicFacts) == 1
    assert event.deterministicFacts[0].fact == "revert_detected"
    assert event.deterministicFacts[0].provenance.analyzer == "revert-detector"


def test_parse_event_missing_fields():
    """Missing optional fields should use defaults, not crash."""
    from refract import _parse_event
    minimal = {"eventType": "sentence_removed"}
    event = _parse_event(minimal)
    assert event.eventType == "sentence_removed"
    assert event.fromRevisionId == 0
    assert event.deterministicFacts == []
    assert event.modelInterpretation is None
    assert event.schemaVersion is None


def test_parse_event_empty_facts():
    """Empty deterministicFacts array should parse cleanly."""
    from refract import _parse_event
    raw = {
        "eventType": "section_reorganized",
        "fromRevisionId": 1,
        "toRevisionId": 2,
        "deterministicFacts": [],
    }
    event = _parse_event(raw)
    assert event.deterministicFacts == []


def test_parse_event_fact_without_provenance():
    """Fact without provenance should have None provenance."""
    from refract import _parse_event
    raw = {
        "eventType": "citation_added",
        "fromRevisionId": 1,
        "toRevisionId": 2,
        "deterministicFacts": [{"fact": "citation_changed"}],
    }
    event = _parse_event(raw)
    assert len(event.deterministicFacts) == 1
    assert event.deterministicFacts[0].provenance is None


def test_parse_event_with_model_interpretation():
    """modelInterpretation field should be parsed (set by downstream consumers)."""
    from refract import _parse_event
    raw = {
        "eventType": "sentence_modified",
        "fromRevisionId": 1,
        "toRevisionId": 2,
        "deterministicFacts": [],
        "modelInterpretation": {"semanticChange": "softened", "confidence": 0.9},
    }
    event = _parse_event(raw)
    assert event.modelInterpretation == {"semanticChange": "softened", "confidence": 0.9}


# ── _flatten_event ───────────────────────────────────────────────────

def test_flatten():
    """Test that flatten_event produces the correct flat dict."""
    from refract import _parse_event, _flatten_event
    event = _parse_event({
        "eventType": "citation_added",
        "schemaVersion": "0.4.0",
        "fromRevisionId": 10,
        "toRevisionId": 11,
        "section": "body",
        "before": "",
        "after": "https://example.com",
        "timestamp": "2026-01-01T00:00:00Z",
        "layer": "observed",
        "deterministicFacts": [
            {
                "fact": "citation_changed",
                "detail": "type=added",
                "provenance": {
                    "analyzer": "citation-tracker",
                    "version": "0.4.0",
                    "inputHashes": [],
                },
            }
        ],
    })
    flat = _flatten_event(event)
    assert flat["event_type"] == "citation_added"
    assert flat["fact"] == "citation_changed"
    assert flat["analyzer_name"] == "citation-tracker"


def test_flatten_no_facts():
    """Event with no deterministicFacts should have empty fact fields."""
    from refract import _parse_event, _flatten_event
    event = _parse_event({
        "eventType": "sentence_removed",
        "fromRevisionId": 1,
        "toRevisionId": 2,
        "deterministicFacts": [],
    })
    flat = _flatten_event(event)
    assert flat["fact"] == ""
    assert flat["fact_detail"] == ""
    assert flat["analyzer_name"] == ""


def test_flatten_no_provenance():
    """Event with facts but no provenance should have empty analyzer fields."""
    from refract import _parse_event, _flatten_event
    event = _parse_event({
        "eventType": "revert_detected",
        "fromRevisionId": 1,
        "toRevisionId": 2,
        "deterministicFacts": [{"fact": "revert_detected"}],
    })
    flat = _flatten_event(event)
    assert flat["fact"] == "revert_detected"
    assert flat["analyzer_name"] == ""


# ── RefractError ─────────────────────────────────────────────────────

def test_refract_error():
    """RefractError is a proper exception."""
    err = RefractError("CLI failed")
    assert str(err) == "CLI failed"
    assert isinstance(err, Exception)


def test_refract_error_subprocess_message():
    """RefractError preserves the full error message from the CLI."""
    err = RefractError(
        "refract CLI exited with code 1: Page not found"
    )
    assert "code 1" in str(err)
    assert "Page not found" in str(err)


# ── _find_binary ─────────────────────────────────────────────────────

def test_find_binary_explicit():
    """_find_binary returns the preferred binary if it exists."""
    binary = Refract._find_binary("python3")
    assert binary == "python3"  # python3 exists on all test platforms


def test_find_binary_nonexistent():
    """_find_binary ignores a missing preferred binary and uses an available CLI."""
    binary = Refract._find_binary("nonexistent-binary-xyz")
    assert binary in ("refract", "npx")


def test_find_binary_none():
    """_find_binary with no argument searches PATH for refract, falls back to npx."""
    binary = Refract._find_binary(None)
    assert binary in ("refract", "npx")


# ── Refract CLI wrapper (unit tests, no actual CLI calls) ────────────

def test_refract_constructor_default():
    """Refract() with no args finds binary automatically."""
    r = Refract()
    assert r._binary in ("refract", "npx")


def test_refract_constructor_explicit():
    """Refract(binary='echo') uses the explicit path."""
    r = Refract(binary="echo")
    assert r._binary == "echo"


def test_refract_constructor_explicit_js_path(tmp_path):
    """Explicit local CLI JavaScript paths should not fall back to npx."""
    cli = tmp_path / "cli.js"
    cli.write_text("#!/usr/bin/env node\n")

    r = Refract(binary=str(cli))

    assert r._binary == str(cli)


def test_run_uses_node_for_js_binary(monkeypatch, tmp_path):
    """A local built CLI file is invoked with node even when not executable."""
    cli = tmp_path / "cli.js"
    cli.write_text("#!/usr/bin/env node\n")
    r = Refract(binary=str(cli))

    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    r._run(["--version"])

    assert captured["cmd"] == ["node", str(cli), "--version"]


def test_refract_truthy():
    """Placeholder for CLI integration tests (requires refract CLI installed)."""
    assert True


def test_analyze_parses_ndjson(monkeypatch):
    """analyze() should parse the CLI's machine-readable JSON output."""
    raw_event = {
        "eventType": "revert_detected",
        "fromRevisionId": 10,
        "toRevisionId": 11,
        "after": "reverted vandalism",
        "deterministicFacts": [],
    }

    def fake_run(self, args):
        assert args == ["analyze", "Earth", "--depth", "brief", "--json"]
        return json.dumps(raw_event) + "\n"

    monkeypatch.setattr(Refract, "_run", fake_run)
    events = Refract(binary="echo").analyze("Earth")

    assert len(events) == 1
    assert events[0].eventType == "revert_detected"
    assert events[0].toRevisionId == 11


def test_langchain_loader_accepts_typed_events(monkeypatch):
    """The LangChain loader should handle the EvidenceEvent dataclasses the client returns."""
    pytest = __import__("pytest")
    pytest.importorskip("langchain_core")

    from refract_langchain import RefractLoader

    event = EvidenceEvent(
        eventType="sentence_first_seen",
        fromRevisionId=1,
        toRevisionId=2,
        after="A sourced claim.",
        section="Lead",
        deterministicFacts=[
            DeterministicFact(
                fact="sentence_first_seen",
                provenance=FactProvenance(analyzer="sentence-tracker", version="0.5.0"),
            )
        ],
        layer="observed",
        timestamp="2026-01-01T00:00:00Z",
    )

    calls = []

    def fake_analyze(self, page, depth="brief", **flags):
        calls.append((page, depth, flags))
        return [event]

    monkeypatch.setattr(Refract, "analyze", fake_analyze)
    loader = RefractLoader(page="Earth", depth="forensic", api_url="https://wiki.example.org/w/api.php")

    docs = list(loader.lazy_load())

    # depth and api_url reach the CLI; both were dropped when this called export().
    assert calls == [("Earth", "forensic", {"api": "https://wiki.example.org/w/api.php"})]

    assert len(docs) == 1
    assert docs[0].page_content == "A sourced claim."
    assert docs[0].metadata["event_type"] == "sentence_first_seen"
    assert docs[0].metadata["analyzer"] == "sentence-tracker"
    assert docs[0].metadata["stability_score"] == 0.9


def test_compute_survival_records():
    from refract import compute_survival_records, EvidenceEvent

    events = [
        EvidenceEvent(
            eventType="sentence_first_seen",
            fromRevisionId=1,
            toRevisionId=2,
            section="Summary",
            after="Treatment protocol shows positive response.",
            timestamp="2026-01-01T00:00:00Z",
        ),
        EvidenceEvent(
            eventType="sentence_removed",
            fromRevisionId=2,
            toRevisionId=3,
            section="Summary",
            before="Treatment protocol shows positive response.",
            timestamp="2026-01-11T00:00:00Z",
        ),
    ]

    records = compute_survival_records(events)
    assert len(records) == 1
    assert records[0]["event_observed"] == 1
    assert records[0]["duration_days"] == 10.0
    assert records[0]["section"] == "Summary"


def test_to_networkx():
    pytest = __import__("pytest")
    pytest.importorskip("networkx")
    from refract import to_networkx, EvidenceEvent, DeterministicFact

    events = [
        EvidenceEvent(
            eventType="citation_added",
            fromRevisionId=10,
            toRevisionId=20,
            timestamp="2026-01-01T00:00:00Z",
            deterministicFacts=[
                DeterministicFact(fact="citation_added", detail="url=https://example.org/study")
            ],
        )
    ]

    g = to_networkx(events)
    assert g.has_edge("rev:10", "rev:20")
    assert g.has_edge("rev:20", "url=https://example.org/study")


# ── refract_eval ────────────────────────────────────────────────────

def _write_events(tmp_path, events):
    path = tmp_path / "events.jsonl"
    path.write_text("\n".join(json.dumps(e) for e in events) + "\n")
    return str(path)


def test_leakage_benchmark_accepts_a_date_only_cutoff(tmp_path):
    """The documented cutoff is a bare date; event timestamps end in Z."""
    from refract_eval import build_leakage_benchmark

    path = _write_events(tmp_path, [
        {"eventType": "sentence_first_seen", "after": "A sentence seen before the cutoff.",
         "timestamp": "2024-05-31T23:59:59Z", "toRevisionId": 1},
        {"eventType": "sentence_first_seen", "after": "A sentence seen after the cutoff.",
         "timestamp": "2024-06-01T00:00:01Z", "toRevisionId": 2},
    ])

    records = build_leakage_benchmark(path, cutoff="2024-06-01")

    assert [r.leaked for r in records] == [False, True]
    assert [r.leaked for r in build_leakage_benchmark(path, cutoff="2024-06-01T00:00:00+00:00")] == [False, True]


def test_recency_benchmark_accepts_a_date_only_knowledge_date(tmp_path):
    from refract_eval import build_recency_benchmark

    path = _write_events(tmp_path, [
        {"eventType": "sentence_first_seen", "after": "Known.", "timestamp": "2024-05-01T00:00:00Z"},
        {"eventType": "sentence_modified", "after": "Not yet known.", "timestamp": "2024-07-01T00:00:00Z"},
    ])

    result = build_recency_benchmark(path, "2024-06-01")

    assert result["claims_known"] == 1
    assert [c["claim"] for c in result["not_yet_known"]] == ["Not yet known."]

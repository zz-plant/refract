import { describe, expect, it, vi } from "vitest";
import {
	loadFromQueryParams,
	parseEventsPayload,
	parseMarkersPayload,
	validateSafeBundleUrl,
} from "../src/export/UrlLoader.js";

describe("UrlLoader", () => {
	it("allows https URLs and same-origin relative paths, and blocks unsafe schemes", () => {
		const base = "https://zz-plant.github.io/refract/viewer/";
		expect(
			validateSafeBundleUrl("https://example.org/events.ndjson", base),
		).toBe("https://example.org/events.ndjson");
		expect(validateSafeBundleUrl("./sample-data.jsonl", base)).toBe(
			"https://zz-plant.github.io/refract/viewer/sample-data.jsonl",
		);
		expect(validateSafeBundleUrl("javascript:alert(1)", base)).toBeNull();
		expect(validateSafeBundleUrl("data:text/plain,hello", base)).toBeNull();
		expect(
			validateSafeBundleUrl("http://insecure.example.com/a.ndjson", base),
		).toBeNull();
	});

	it("parses NDJSON, JSON arrays, and refract-verification-bundle/v1 objects", () => {
		const ev = {
			eventType: "sentence_modified",
			fromRevisionId: 1,
			toRevisionId: 2,
			section: "(lead)",
			before: "a",
			after: "b",
			deterministicFacts: [],
			layer: "observed",
			timestamp: "2026-01-01T00:00:00Z",
		};
		expect(
			parseEventsPayload(`${JSON.stringify(ev)}\n${JSON.stringify(ev)}`),
		).toHaveLength(2);
		expect(parseEventsPayload(JSON.stringify([ev]))).toHaveLength(1);
		expect(
			parseEventsPayload(
				JSON.stringify({
					format: "refract-verification-bundle/v1",
					events: [ev],
				}),
			),
		).toHaveLength(1);
	});

	it("parses ExternalTimelineMarker JSON arrays and skips malformed items", () => {
		const markers = parseMarkersPayload(
			JSON.stringify([
				{ timestamp: "2025-11-02T00:00:00Z", label: "Public statement" },
				{ label: "missing timestamp" },
			]),
		);
		expect(markers).toEqual([
			{ timestamp: "2025-11-02T00:00:00Z", label: "Public statement" },
		]);
	});

	it("loads both ?src= events and ?markers= overlays via fetcher", async () => {
		const ev = {
			eventType: "revert_detected",
			fromRevisionId: 10,
			toRevisionId: 11,
			section: "",
			before: "",
			after: "Undid revision 10",
			deterministicFacts: [],
			layer: "policy_coded",
			timestamp: "2026-01-02T00:00:00Z",
		};
		const mockFetch = vi.fn(async (url: string | URL | Request) => {
			const href = String(url);
			if (href.includes("markers.json")) {
				return new Response(
					JSON.stringify([
						{ timestamp: "2026-01-02T00:00:00Z", label: "Report" },
					]),
					{ status: 200 },
				);
			}
			return new Response(JSON.stringify(ev), { status: 200 });
		});

		const loaded = await loadFromQueryParams(
			"?src=https://example.org/events.ndjson&markers=https://example.org/markers.json",
			"https://zz-plant.github.io/refract/viewer/",
			mockFetch as unknown as typeof fetch,
		);
		expect(loaded).not.toBeNull();
		expect(loaded?.events).toHaveLength(1);
		expect(loaded?.markers).toHaveLength(1);
		expect(loaded?.markers[0].label).toBe("Report");
	});
});

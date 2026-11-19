import type { EvidenceEvent, ExternalTimelineMarker } from "../types.js";

export interface LoadedRemoteBundle {
	events: EvidenceEvent[];
	markers: ExternalTimelineMarker[];
	sourceUrl?: string;
}

/**
 * Resolve an untrusted query-string URL for client-side fetch.
 * Allows only https: URLs and same-origin relative paths (blocks javascript:, data:, http:, etc.).
 */
export function validateSafeBundleUrl(
	raw: string | null,
	baseHref: string,
): string | null {
	if (!raw) return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;
	try {
		const resolved = new URL(trimmed, baseHref);
		if (resolved.protocol === "https:") return resolved.href;
		const base = new URL(baseHref);
		if (
			resolved.origin === base.origin &&
			(resolved.protocol === "http:" || resolved.protocol === "https:")
		) {
			return resolved.href;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Parse an exported Refract file in NDJSON/JSONL, JSON array, or
 * `refract-verification-bundle/v1` (`{ events: [...] }`) format.
 */
export function parseEventsPayload(text: string): EvidenceEvent[] {
	const trimmed = text.trim();
	if (!trimmed) return [];

	if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (Array.isArray(parsed)) {
				return parsed as EvidenceEvent[];
			}
			if (
				parsed &&
				typeof parsed === "object" &&
				"events" in parsed &&
				Array.isArray((parsed as { events: unknown }).events)
			) {
				return (parsed as { events: EvidenceEvent[] }).events;
			}
			// Single JSON object line (1-line NDJSON)
			if (parsed && typeof parsed === "object" && "eventType" in parsed) {
				return [parsed as EvidenceEvent];
			}
		} catch {
			// Fall through to NDJSON line-by-line parsing
		}
	}

	const lines = trimmed.split("\n").filter((l) => l.trim().length > 0);
	return lines.map((l) => JSON.parse(l) as EvidenceEvent);
}

/** Parse a JSON array of ExternalTimelineMarker records. */
export function parseMarkersPayload(text: string): ExternalTimelineMarker[] {
	const trimmed = text.trim();
	if (!trimmed) return [];
	const parsed = JSON.parse(trimmed) as unknown;
	if (!Array.isArray(parsed)) return [];
	return parsed.filter(
		(m): m is ExternalTimelineMarker =>
			Boolean(m) &&
			typeof m === "object" &&
			typeof (m as ExternalTimelineMarker).timestamp === "string" &&
			typeof (m as ExternalTimelineMarker).label === "string",
	);
}

/**
 * Read `?src=` and optional `?markers=` from a query string and fetch them in the browser.
 * Returns null if no valid `src` parameter is present.
 */
export async function loadFromQueryParams(
	search: string,
	baseHref: string,
	fetcher: typeof fetch = fetch,
): Promise<LoadedRemoteBundle | null> {
	const params = new URLSearchParams(search);
	const srcUrl = validateSafeBundleUrl(params.get("src"), baseHref);
	if (!srcUrl) return null;

	const resp = await fetcher(srcUrl);
	if (!resp.ok) {
		throw new Error(`HTTP ${resp.status} loading ${srcUrl}`);
	}
	const events = parseEventsPayload(await resp.text());

	let markers: ExternalTimelineMarker[] = [];
	const markersUrl = validateSafeBundleUrl(params.get("markers"), baseHref);
	if (markersUrl) {
		const mResp = await fetcher(markersUrl);
		if (mResp.ok) {
			markers = parseMarkersPayload(await mResp.text());
		}
	}

	return { events, markers, sourceUrl: srcUrl };
}

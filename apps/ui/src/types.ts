// Event types come from the engine's schema package, as types only: they are
// erased at build time, so nothing from it is bundled into the browser. The
// viewer used to keep its own copy here, which still listed the claim_* names
// after the engine had renamed them sentence_* and added two event types.
import type {
	EventType,
	ModelInterpretation,
} from "@refract-org/evidence-graph";

export type {
	ActorCohortSummary,
	DeterministicFact,
	EventType,
	EvidenceEvent,
	EvidenceLayer,
	ExternalTimelineMarker,
	FactProvenance,
	ModelInterpretation,
	PolicyDimension,
} from "@refract-org/evidence-graph";

export type DiscussionType = NonNullable<ModelInterpretation["discussionType"]>;

export interface DiffLine {
	type: "added" | "removed" | "unchanged";
	content: string;
	lineNumber: number;
}

export interface TimelineFilter {
	eventTypes: Set<EventType>;
	dateRange: { start: string; end: string } | null;
}

/**
 * Every event type the engine emits. Typed as a record so the compiler rejects
 * a list that misses a type or names one the engine does not have.
 */
const EVENT_TYPE_RECORD: Record<EventType, true> = {
	sentence_first_seen: true,
	sentence_removed: true,
	sentence_modified: true,
	sentence_reintroduced: true,
	citation_added: true,
	citation_removed: true,
	citation_replaced: true,
	template_added: true,
	template_removed: true,
	template_parameter_changed: true,
	revert_detected: true,
	edit_cluster_detected: true,
	talk_activity_spike: true,
	section_reorganized: true,
	lead_promotion: true,
	lead_demotion: true,
	page_moved: true,
	wikilink_added: true,
	wikilink_removed: true,
	category_added: true,
	category_removed: true,
	protection_changed: true,
	talk_page_correlated: true,
	talk_thread_opened: true,
	talk_thread_archived: true,
	talk_reply_added: true,
};

export const EVENT_TYPES = Object.keys(EVENT_TYPE_RECORD) as EventType[];

export function isEventType(value: unknown): value is EventType {
	return typeof value === "string" && Object.hasOwn(EVENT_TYPE_RECORD, value);
}

/** Events whose before/after carry sentence text. */
export const WORDING_EVENT_TYPES: ReadonlySet<EventType> = new Set<EventType>([
	"sentence_modified",
	"sentence_first_seen",
	"sentence_removed",
	"sentence_reintroduced",
]);

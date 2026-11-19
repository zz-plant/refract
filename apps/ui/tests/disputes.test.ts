import { beforeEach, describe, expect, it } from "vitest";
import { EditVelocityChart } from "../src/disputes/EditVelocityChart.js";
import { RevertClusterDisplay } from "../src/disputes/RevertClusterDisplay.js";
import { TalkPageTimeline } from "../src/disputes/TalkPageTimeline.js";
import type { EvidenceEvent } from "../src/types.js";

describe("EditVelocityChart", () => {
	let container: HTMLElement;

	beforeEach(() => {
		container = document.createElement("div");
	});

	it("renders empty state when no events exist", () => {
		const chart = new EditVelocityChart(container);
		chart.setData([]);

		expect(container.textContent).toContain("No events to chart");
	});

	it("groups events into daily velocity buckets and renders bars", () => {
		const chart = new EditVelocityChart(container);
		const events: EvidenceEvent[] = [
			{
				eventId: "e1",
				eventType: "sentence_first_seen",
				fromRevisionId: 1,
				toRevisionId: 2,
				timestamp: "2026-05-10T10:00:00Z",
				section: "Lead",
				before: "",
				after: "First statement",
				deterministicFacts: [],
				layer: "observed",
			},
			{
				eventId: "e2",
				eventType: "revert_detected",
				fromRevisionId: 2,
				toRevisionId: 3,
				timestamp: "2026-05-10T11:00:00Z",
				section: "Lead",
				before: "First statement",
				after: "",
				deterministicFacts: [],
				layer: "observed",
			},
		];

		chart.setData(events);
		expect(container.querySelectorAll(".bar-group").length).toBe(1);
		expect(container.querySelectorAll(".bar").length).toBe(2);

		chart.setMarkers([
			{
				timestamp: "2026-05-10T08:00:00Z",
				label: "External report published",
				category: "report",
			},
		]);
		expect(container.querySelectorAll(".has-external-marker").length).toBe(1);
		expect(container.textContent).toContain("External report published");
	});
});

describe("RevertClusterDisplay", () => {
	let container: HTMLElement;

	beforeEach(() => {
		container = document.createElement("div");
	});

	it("renders empty state when no revert events exist", () => {
		const display = new RevertClusterDisplay(container);
		display.setData([]);

		expect(container.textContent).toContain("No revert events detected");
	});

	it("renders revert cluster cards with count badge and actorCohort pseudonyms", () => {
		const display = new RevertClusterDisplay(container);
		const events: EvidenceEvent[] = [
			{
				eventId: "rev-1",
				eventType: "revert_detected",
				fromRevisionId: 100,
				toRevisionId: 101,
				timestamp: "2026-07-01T15:00:00Z",
				section: "Safety",
				before: "Claim with caveat",
				after: "Claim without caveat",
				deterministicFacts: [
					{
						fact: "Reverted 1 edit by user A",
					},
				],
				actorCohort: {
					actorPseudonym: "Actor_1",
					revertedActorPseudonym: "Actor_2",
					distinctActors: 2,
					singleActor: false,
				},
				layer: "observed",
			},
		];

		display.setData(events);
		const cards = container.querySelectorAll(".card");
		expect(cards.length).toBe(1);
		expect(cards[0].textContent).toContain("r101");
		expect(cards[0].textContent).toContain("Actor_1 ↺ Actor_2");
		expect(cards[0].textContent).toContain("Safety");
		expect(cards[0].textContent).toContain("Reverted 1 edit by user A");
	});
});

describe("TalkPageTimeline", () => {
	let container: HTMLElement;

	beforeEach(() => {
		container = document.createElement("div");
	});

	it("renders empty state when no talk page events exist", () => {
		const timeline = new TalkPageTimeline(container);
		timeline.setData([]);

		expect(container.textContent).toContain("No talk page events found");
	});

	it("renders timeline items for talk page discussions", () => {
		const timeline = new TalkPageTimeline(container);
		const events: EvidenceEvent[] = [
			{
				eventId: "talk-1",
				eventType: "talk_page_correlated",
				fromRevisionId: 5,
				toRevisionId: 6,
				timestamp: "2026-08-01T12:00:00Z",
				section: "Talk:Article",
				before: "",
				after: "Discussion started regarding trial validity",
				deterministicFacts: [
					{
						fact: "Thread opened: 'Trial Validity Analysis'",
					},
				],
				layer: "observed",
			},
		];

		timeline.setData(events);
		const items = container.querySelectorAll(".timeline-item");
		expect(items.length).toBe(1);
		expect(items[0].textContent).toContain("talk page correlated");
		expect(items[0].textContent).toContain(
			"Thread opened: 'Trial Validity Analysis'",
		);
	});
});

import { Throbber } from "./brand/Throbber.js";
import { CitationChurnChart } from "./citations/CitationChurnChart.js";
import { SourceChangeTable } from "./citations/SourceChangeTable.js";
import { EditVelocityChart } from "./disputes/EditVelocityChart.js";
import { RevertClusterDisplay } from "./disputes/RevertClusterDisplay.js";
import { TalkPageTimeline } from "./disputes/TalkPageTimeline.js";
import { ImportUpload } from "./export/ImportUpload.js";
import { SchemaViewer } from "./export/SchemaViewer.js";
import { TimelineExport } from "./export/TimelineExport.js";
import { CertaintyTimeline } from "./language/CertaintyTimeline.js";
import { WordingDiffCard } from "./language/WordingDiffCard.js";
import { DiffView } from "./timeline/DiffView.js";
import { EventFilter } from "./timeline/EventFilter.js";
import { TimelineView } from "./timeline/TimelineView.js";
import type { EventType, EvidenceEvent } from "./types.js";
import "./styles/main.css";

let allEvents: EvidenceEvent[] = [];

const timelineView = new TimelineView({
	container: document.getElementById("panel-timeline")!,
	onSelectEvent: (event) => {
		if (event) diffView.showDiff(event);
		else diffView.clear();
	},
});

const diffView = new DiffView(document.getElementById("panel-diff")!);

const citationChart = new CitationChurnChart(
	document.getElementById("panel-citations")!,
);
const certaintyTimeline = new CertaintyTimeline(
	document.getElementById("panel-certainty")!,
);

const schemaViewer = new SchemaViewer(document.getElementById("panel-schema")!);
const sourceChangeTable = new SourceChangeTable(
	document.getElementById("panel-source")!,
);
const wordingDiffCard = new WordingDiffCard(
	document.getElementById("panel-wording")!,
);

const disputesContainer = document.getElementById("panel-disputes")!;
const revertSection = document.createElement("div");
const velocitySection = document.createElement("div");
const talkSection = document.createElement("div");
velocitySection.style.marginTop = "1rem";
talkSection.style.marginTop = "1rem";
disputesContainer.appendChild(revertSection);
disputesContainer.appendChild(velocitySection);
disputesContainer.appendChild(talkSection);

const revertClusterDisplay = new RevertClusterDisplay(revertSection);
const editVelocityChart = new EditVelocityChart(velocitySection);
const talkPageTimeline = new TalkPageTimeline(talkSection);

const filter = new EventFilter({
	container: document.getElementById("filter-area")!,
	allTypes: [],
	onChange: (activeTypes) => {
		applyFilters(activeTypes);
	},
});

const exportCtrl = new TimelineExport(document.getElementById("export-area")!);

new ImportUpload(document.getElementById("import-area")!, (events) => {
	allEvents = events;
	exportCtrl.setData(events);
	const allTypes = collectEventTypes(events);
	filter.setTypes(allTypes);
	timelineView.setData(events);
	updateAll(events);
});

async function loadSampleData(): Promise<void> {
	const throbber = new Throbber(
		document.getElementById("import-status")!,
		"Loading sample events",
	);
	throbber.start();
	try {
		// BASE_URL is /refract/viewer/ on the published site, / under the dev server.
		const resp = await fetch(`${import.meta.env.BASE_URL}sample-data.jsonl`);
		const text = await resp.text();
		const lines = text.split("\n").filter((l) => l.trim().length > 0);
		const events: EvidenceEvent[] = lines.map((l) => JSON.parse(l));
		allEvents = events;
		exportCtrl.setData(events);
		const allTypes = collectEventTypes(events);
		filter.setTypes(allTypes);
		timelineView.setData(events);
		updateAll(events);
	} catch (err) {
		console.warn("Could not load sample data:", err);
	} finally {
		throbber.stop();
	}
}

function collectEventTypes(events: EvidenceEvent[]): EventType[] {
	const set = new Set<EventType>();
	for (const e of events) {
		set.add(e.eventType);
	}
	return Array.from(set).sort();
}

// Every panel but the timeline. The timeline takes the full set once, on load,
// and a filter through applyFilter, so its count reads "3 of 12". Setting its
// data from here made the filtered set its total, and the count read "3 of 3".
function updateAll(events: EvidenceEvent[]): void {
	citationChart.setData(events);
	certaintyTimeline.setData(events);
	schemaViewer.setData(events as unknown as Record<string, unknown>[]);
	sourceChangeTable.setData(events);
	wordingDiffCard.setData(events);
	revertClusterDisplay.setData(events);
	editVelocityChart.setData(events);
	talkPageTimeline.setData(events);
}

function applyFilters(activeTypes: Set<EventType>): void {
	const filtered = allEvents.filter((e) => activeTypes.has(e.eventType));
	timelineView.applyFilter(filtered);
	exportCtrl.setData(filtered);
	updateAll(filtered);
}

loadSampleData();

import type { EvidenceEvent, ExternalTimelineMarker } from "../types.js";

interface VelocityBucket {
	date: string;
	count: number;
	reverts: number;
	label: string;
	markers: ExternalTimelineMarker[];
}

export class EditVelocityChart {
	private container: HTMLElement;
	private events: EvidenceEvent[] = [];
	private markers: ExternalTimelineMarker[] = [];

	constructor(container: HTMLElement) {
		this.container = container;
	}

	setData(events: EvidenceEvent[]): void {
		this.events = events;
		this.render();
	}

	setMarkers(markers: ExternalTimelineMarker[]): void {
		this.markers = markers;
		this.render();
	}

	render(): void {
		this.container.innerHTML = "";

		const title = document.createElement("div");
		title.className = "panel-title";
		title.textContent = "Events per day";
		this.container.appendChild(title);

		const buckets = this.computeBuckets();

		if (buckets.length === 0) {
			const empty = document.createElement("div");
			empty.style.cssText =
				"color:var(--text-dim);font-size:0.85rem;padding:1rem 0;";
			empty.textContent = "No events to chart.";
			this.container.appendChild(empty);
			return;
		}

		const maxCount = Math.max(
			...buckets.map((b) => Math.max(b.count, b.reverts)),
			1,
		);

		const chart = document.createElement("div");
		chart.className = "bar-chart";

		for (const bucket of buckets) {
			const group = document.createElement("div");
			group.className = "bar-group";
			if (bucket.markers.length > 0) {
				group.classList.add("has-external-marker");
				group.style.borderTop = "2px dashed var(--orange)";
			}

			const countBar = document.createElement("div");
			countBar.className = "bar added";
			countBar.style.height = `${(bucket.count / maxCount) * 100}%`;
			const markerNote =
				bucket.markers.length > 0
					? ` · Context: ${bucket.markers.map((m) => m.label).join("; ")}`
					: "";
			countBar.title = `Events: ${bucket.count}${markerNote}`;
			group.appendChild(countBar);

			const revertBar = document.createElement("div");
			revertBar.className = "bar removed";
			revertBar.style.height = `${(bucket.reverts / maxCount) * 100}%`;
			revertBar.title = `Reverts: ${bucket.reverts}${markerNote}`;
			group.appendChild(revertBar);

			chart.appendChild(group);
		}

		this.container.appendChild(chart);

		const xLabels = document.createElement("div");
		xLabels.style.cssText =
			"display:flex;justify-content:space-between;font-size:0.65rem;color:var(--text-dim);margin-top:0.25rem;";

		const step = Math.max(1, Math.floor(buckets.length / 6));
		for (let i = 0; i < buckets.length; i += step) {
			const label = document.createElement("span");
			label.textContent = buckets[i].label;
			xLabels.appendChild(label);
		}
		if (buckets.length > 0) {
			const lastLabel = document.createElement("span");
			lastLabel.textContent = buckets[buckets.length - 1].label;
			xLabels.appendChild(lastLabel);
		}

		this.container.appendChild(xLabels);

		const legend = document.createElement("div");
		legend.style.cssText =
			"display:flex;gap:1rem;font-size:0.75rem;color:var(--text-dim);margin-top:0.25rem;";
		const allLegend = createBarLegend("All events", "var(--green)");
		const revertLegend = createBarLegend("Reverts", "var(--red)");
		legend.append(allLegend, revertLegend);
		if (this.markers.length > 0) {
			const markerLegend = createBarLegend("External context", "var(--orange)");
			legend.appendChild(markerLegend);
		}
		this.container.appendChild(legend);

		if (this.markers.length > 0) {
			const markerList = document.createElement("div");
			markerList.className = "external-markers-list";
			markerList.style.cssText =
				"margin-top:0.5rem;font-size:0.75rem;color:var(--text-dim);display:flex;flex-direction:column;gap:0.2rem;";
			for (const m of this.markers) {
				const row = document.createElement("div");
				row.className = "external-marker-item";
				row.textContent = `${m.timestamp.slice(0, 10)} · ${m.label}${m.category ? ` [${m.category}]` : ""}`;
				markerList.appendChild(row);
			}
			this.container.appendChild(markerList);
		}
	}

	private computeBuckets(): VelocityBucket[] {
		if (this.events.length === 0) return [];

		const sorted = [...this.events].sort(
			(a, b) =>
				new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
		);

		const buckets = new Map<string, VelocityBucket>();

		for (const event of sorted) {
			const d = new Date(event.timestamp);
			const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

			let bucket = buckets.get(key);
			if (!bucket) {
				bucket = {
					date: key,
					count: 0,
					reverts: 0,
					label: `${d.getMonth() + 1}/${d.getDate()}`,
					markers: [],
				};
				buckets.set(key, bucket);
			}

			bucket.count++;
			if (event.eventType === "revert_detected") {
				bucket.reverts++;
			}
		}

		for (const marker of this.markers) {
			const d = new Date(marker.timestamp);
			if (Number.isNaN(d.getTime())) continue;
			const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
			const bucket = buckets.get(key);
			if (bucket) {
				bucket.markers.push(marker);
			}
		}

		return Array.from(buckets.values()).sort((a, b) =>
			a.date.localeCompare(b.date),
		);
	}
}

function createBarLegend(label: string, color: string): HTMLElement {
	const item = document.createElement("span");
	item.style.cssText = "display:flex;align-items:center;gap:0.3rem;";
	const dot = document.createElement("span");
	dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};`;
	item.appendChild(dot);
	item.appendChild(document.createTextNode(label));
	return item;
}

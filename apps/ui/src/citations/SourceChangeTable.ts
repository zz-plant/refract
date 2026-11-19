import type { EvidenceEvent } from "../types.js";

interface SourceChange {
	revisionId: number;
	timestamp: string;
	section: string;
	changeType: string;
	detail: string;
}

export class SourceChangeTable {
	private container: HTMLElement;
	private events: EvidenceEvent[] = [];

	constructor(container: HTMLElement) {
		this.container = container;
	}

	setData(events: EvidenceEvent[]): void {
		this.events = events;
		this.render();
	}

	render(): void {
		this.container.innerHTML = "";

		const title = document.createElement("div");
		title.className = "panel-title";
		title.textContent = "Source changes";
		this.container.appendChild(title);

		const changes = this.computeChanges();

		if (changes.length === 0) {
			const empty = document.createElement("div");
			empty.style.cssText =
				"color:var(--text-dim);font-size:0.85rem;padding:1rem 0;";
			empty.textContent = "No source/citation changes found.";
			this.container.appendChild(empty);
			return;
		}

		const table = document.createElement("table");
		table.className = "data-table source-table";

		// Detail is last so it takes the width the short columns leave. The
		// revision id is on each row's tooltip rather than in a column of its own.
		const thead = document.createElement("thead");
		thead.innerHTML = `
      <tr>
        <th>Date</th>
        <th>Type</th>
        <th>Section</th>
        <th>Detail</th>
      </tr>
    `;
		table.appendChild(thead);

		const tbody = document.createElement("tbody");
		for (const ch of changes) {
			const tr = document.createElement("tr");
			tr.title = `Revision r${ch.revisionId}`;
			const ts = new Date(ch.timestamp);
			// textContent, not innerHTML: section and detail come from the loaded file.
			for (const text of [
				ts.toLocaleDateString(),
				ch.changeType,
				ch.section,
				ch.detail,
			]) {
				const td = document.createElement("td");
				td.textContent = text;
				tr.appendChild(td);
			}
			tbody.appendChild(tr);
		}
		table.appendChild(tbody);
		this.container.appendChild(table);
	}

	private computeChanges(): SourceChange[] {
		const citationEvents = this.events.filter(
			(e) =>
				e.eventType === "citation_added" ||
				e.eventType === "citation_removed" ||
				e.eventType === "citation_replaced",
		);

		return citationEvents.map((e) => {
			const sourceFact = e.deterministicFacts.find(
				(f) => f.fact === "citation_source" && f.detail,
			);
			const anchorStatus = e.deterministicFacts.find(
				(f) => f.fact === "citation_anchor_status" && f.detail,
			);
			const baseFact =
				e.deterministicFacts.length > 0
					? e.deterministicFacts[0].detail
						? `${e.deterministicFacts[0].fact} (${e.deterministicFacts[0].detail})`
						: e.deterministicFacts[0].fact
					: e.eventType;
			const parts = [baseFact];
			if (sourceFact?.detail) parts.push(sourceFact.detail);
			if (anchorStatus?.detail) parts.push(anchorStatus.detail);
			return {
				revisionId: e.toRevisionId,
				timestamp: e.timestamp,
				section: e.section,
				changeType: e.eventType.replace("citation_", ""),
				detail: parts.join(" · "),
			};
		});
	}
}

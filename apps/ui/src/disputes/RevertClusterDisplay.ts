import type { EvidenceEvent } from "../types.js";

interface RevertCluster {
	revisionId: number;
	timestamp: string;
	section: string;
	facts: string[];
	actorLabel?: string;
	count: number;
}

export class RevertClusterDisplay {
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
		title.textContent = "Revert clusters";
		this.container.appendChild(title);

		const clusters = this.computeClusters();

		if (clusters.length === 0) {
			const empty = document.createElement("div");
			empty.style.cssText =
				"color:var(--text-dim);font-size:0.85rem;padding:1rem 0;";
			empty.textContent = "No revert events detected.";
			this.container.appendChild(empty);
			return;
		}

		for (const cluster of clusters) {
			const card = document.createElement("div");
			card.className = "card";
			card.style.marginBottom = "0.5rem";

			const header = document.createElement("div");
			header.style.cssText =
				"display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;";

			const label = document.createElement("div");
			label.className = "card-label";
			const ts = new Date(cluster.timestamp);
			const actorSuffix = cluster.actorLabel ? ` · ${cluster.actorLabel}` : "";
			label.textContent = `r${cluster.revisionId} · ${ts.toLocaleDateString()}${actorSuffix}`;
			header.appendChild(label);

			const badge = document.createElement("span");
			badge.style.cssText =
				"background:var(--red);color:#fff;font-size:0.7rem;padding:0.1rem 0.4rem;border-radius:4px;font-weight:600;";
			badge.textContent = `${cluster.count} revert${cluster.count > 1 ? "s" : ""}`;
			header.appendChild(badge);

			card.appendChild(header);

			if (cluster.section) {
				const section = document.createElement("div");
				section.style.cssText =
					"font-size:0.78rem;color:var(--text-dim);margin-bottom:0.3rem;font-family:var(--mono);";
				section.textContent = cluster.section;
				card.appendChild(section);
			}

			for (const fact of cluster.facts) {
				const factEl = document.createElement("div");
				factEl.style.cssText =
					"font-size:0.8rem;padding:0.2rem 0;border-left:2px solid var(--red);padding-left:0.5rem;margin-top:0.2rem;";
				factEl.textContent = fact;
				card.appendChild(factEl);
			}

			this.container.appendChild(card);
		}
	}

	private computeClusters(): RevertCluster[] {
		const revertEvents = this.events.filter(
			(e) => e.eventType === "revert_detected",
		);

		const grouped = new Map<string, RevertCluster>();

		for (const event of revertEvents) {
			const key = `${event.toRevisionId}-${event.section}`;
			let cluster = grouped.get(key);
			if (!cluster) {
				const cohort = event.actorCohort;
				const actorLabel = cohort?.actorPseudonym
					? cohort.revertedActorPseudonym
						? `${cohort.actorPseudonym} ↺ ${cohort.revertedActorPseudonym}`
						: cohort.actorPseudonym
					: undefined;
				cluster = {
					revisionId: event.toRevisionId,
					timestamp: event.timestamp,
					section: event.section,
					facts: [],
					actorLabel,
					count: 0,
				};
				grouped.set(key, cluster);
			}

			cluster.count++;
			for (const fact of event.deterministicFacts) {
				if (!cluster.facts.includes(fact.fact)) {
					cluster.facts.push(fact.fact);
				}
			}

			if (event.timestamp > cluster.timestamp) {
				cluster.timestamp = event.timestamp;
			}
		}

		return Array.from(grouped.values()).sort(
			(a, b) =>
				new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
		);
	}
}

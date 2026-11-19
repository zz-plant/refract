import type { EvidenceEvent } from "../types.js";

interface CertaintyPoint {
	revisionId: number;
	timestamp: string;
	confidence: number;
	label: string;
}

export class CertaintyTimeline {
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
		title.textContent = "Model confidence";
		this.container.appendChild(title);

		const points = this.computePoints();

		if (points.length === 0) {
			const empty = document.createElement("div");
			empty.style.cssText =
				"color:var(--text-dim);font-size:0.85rem;padding:1rem 0;";
			empty.textContent =
				"No model interpretations with confidence scores found.";
			this.container.appendChild(empty);
			return;
		}

		const chart = document.createElement("div");
		chart.className = "certainty-chart";
		chart.style.position = "relative";

		const minConf = Math.min(...points.map((p) => p.confidence));
		const maxConf = Math.max(...points.map((p) => p.confidence));
		const range = maxConf - minConf || 1;
		const totalWidth = points.length * 60;

		for (let i = 0; i < points.length; i++) {
			const p = points[i];
			const y = 100 - ((p.confidence - minConf) / range) * 80 - 10;
			const x = i * 60 + 30;

			const dot = document.createElement("div");
			dot.className = "certainty-dot";
			const confidenceLevel =
				p.confidence >= 0.7 ? "high" : p.confidence >= 0.4 ? "medium" : "low";
			dot.classList.add(confidenceLevel);
			dot.style.left = `${x}px`;
			dot.style.top = `${y}%`;
			dot.title = `r${p.revisionId}: ${(p.confidence * 100).toFixed(0)}%`;

			dot.addEventListener("click", () => {
				const info = document.getElementById("certainty-info");
				if (info) {
					info.textContent = `r${p.revisionId}: ${p.label} (${(p.confidence * 100).toFixed(0)}% confidence)`;
				}
			});

			chart.appendChild(dot);

			if (i < points.length - 1) {
				const next = points[i + 1];
				const nextY = 100 - ((next.confidence - minConf) / range) * 80 - 10;
				const nextX = (i + 1) * 60 + 30;

				const line = document.createElement("div");
				line.className = "certainty-line";
				const angle = Math.atan2(nextY - y, nextX - x) * (180 / Math.PI);
				const lineLength = Math.sqrt(
					(nextX - x) ** 2 +
						(((nextY - y) / 100) * (chart.offsetHeight || 100)) ** 2,
				);
				line.style.width = `${lineLength}px`;
				line.style.left = `${x}px`;
				line.style.top = `${y}%`;
				line.style.transformOrigin = "0 50%";
				line.style.transform = `rotate(${angle}deg)`;
				chart.appendChild(line);
			}
		}

		chart.style.minHeight = "100px";
		chart.style.minWidth = `${totalWidth}px`;
		this.container.appendChild(chart);

		const info = document.createElement("div");
		info.id = "certainty-info";
		info.style.cssText =
			"font-size:0.78rem;color:var(--text-dim);margin-top:0.25rem;font-family:var(--mono);";
		info.textContent = "Click a dot for details.";
		this.container.appendChild(info);

		const legend = document.createElement("div");
		legend.style.cssText =
			"display:flex;gap:1rem;font-size:0.75rem;color:var(--text-dim);margin-top:0.25rem;";
		const high = createCertaintyLegend("High (≥70%)", "var(--green)");
		const med = createCertaintyLegend("Medium (40-69%)", "var(--yellow)");
		const low = createCertaintyLegend("Low (<40%)", "var(--red)");
		legend.append(high, med, low);
		this.container.appendChild(legend);
	}

	private computePoints(): CertaintyPoint[] {
		const modelEvents = this.events.filter(
			(e) => e.modelInterpretation && e.layer === "model_interpretation",
		);

		if (modelEvents.length > 0) {
			return modelEvents.map((e) => ({
				revisionId: e.toRevisionId,
				timestamp: e.timestamp,
				confidence: e.modelInterpretation?.confidence ?? 0,
				label: e.modelInterpretation?.semanticChange ?? "",
			}));
		}

		const points: CertaintyPoint[] = [];
		for (const e of this.events) {
			const cp = e.certaintyProfile;
			if (!cp) continue;
			const total = cp.high + cp.medium + cp.low + cp.hedging;
			if (total === 0) continue;
			const score = (cp.high + 0.6 * cp.medium + 0.2 * cp.low) / total;
			const dir = e.directionSignal ?? "neutral";
			points.push({
				revisionId: e.toRevisionId,
				timestamp: e.timestamp,
				confidence: Number(Math.min(1, Math.max(0, score)).toFixed(2)),
				label: `direction=${dir} (high=${cp.high} med=${cp.medium} low=${cp.low} hedge=${cp.hedging})`,
			});
		}
		return points;
	}
}

function createCertaintyLegend(label: string, color: string): HTMLElement {
	const item = document.createElement("span");
	item.style.cssText = "display:flex;align-items:center;gap:0.3rem;";
	const dot = document.createElement("span");
	dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};`;
	item.appendChild(dot);
	item.appendChild(document.createTextNode(label));
	return item;
}

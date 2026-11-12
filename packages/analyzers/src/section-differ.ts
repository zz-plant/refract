import type { Section, SectionChange } from "@refract-org/evidence-graph";
import type { SectionDiffer } from "./index.js";

export const sectionDiffer: SectionDiffer = {
  extractSections(wikitext: string): Section[] {
    const sections: Section[] = [];
    const lines = wikitext.split("\n");
    // Same pattern and fix as buildSectionCharMap in wikitext-parser.ts: the
    // title is matched whole and trimmed below, so no whitespace is split
    // between quantifiers.
    const headerRegex = /^(=+)([^=]+)\1$/;

    // Pre-compute byte offsets of each line from a single TextEncoder pass
    const bytes = new TextEncoder().encode(wikitext);
    const lineByteOffsets = [0];
    for (let i = 0, lineIdx = 0; i < bytes.length; i++) {
      if (bytes[i] === 0x0a) {
        lineByteOffsets[++lineIdx] = i + 1;
      }
    }
    while (lineByteOffsets.length <= lines.length) {
      lineByteOffsets.push(bytes.length);
    }

    const headerMatches: Array<{
      index: number;
      offset: number;
      level: number;
      title: string;
    }> = [];

    for (let i = 0; i < lines.length; i++) {
      const match = headerRegex.exec(lines[i]);
      if (match) {
        headerMatches.push({
          index: i,
          offset: lineByteOffsets[i],
          level: match[1].length,
          title: match[2].trim(),
        });
      }
    }

    if (headerMatches.length === 0) {
      sections.push({
        title: "",
        level: 1,
        content: wikitext.trim(),
        byteOffset: 0,
      });
      return sections;
    }

    const leadEnd = headerMatches[0].offset;
    const leadContent = wikitext.slice(0, leadEnd).trim();
    if (leadContent) {
      sections.push({
        title: "",
        level: 1,
        content: leadContent,
        byteOffset: 0,
      });
    }

    for (let i = 0; i < headerMatches.length; i++) {
      const header = headerMatches[i];
      const nextOffset = i + 1 < headerMatches.length ? headerMatches[i + 1].offset : bytes.length;
      const headerEnd = lineByteOffsets[header.index + 1] ?? bytes.length;
      const content = wikitext.slice(headerEnd, nextOffset).trim();

      sections.push({
        title: header.title,
        level: header.level,
        content,
        byteOffset: header.offset,
      });
    }

    return sections;
  },

  /** Diff two section arrays, returning added/removed/modified/unchanged changes. */
  diffSections(
    before: Section[],
    after: Section[],
    options?: { renameDetection?: "exact" | "similarity" | "none"; similarityThreshold?: number },
  ): SectionChange[] {
    const renameDetection = options?.renameDetection ?? "exact";
    const similarityThreshold = options?.similarityThreshold ?? 0.8;
    const changes: SectionChange[] = [];
    const beforeByTitle = new Map<string, Section>();
    const afterByTitle = new Map<string, Section>();

    for (const s of before) {
      const key = sectionKey(s);
      beforeByTitle.set(key, s);
    }
    for (const s of after) {
      const key = sectionKey(s);
      afterByTitle.set(key, s);
    }

    // A heading that disappears while another appears is one renamed section
    // when the text under it stayed put: identical for `exact`, and for
    // `similarity` also when its word overlap reaches the threshold.
    const renamedTo = new Map<string, string>();
    if (renameDetection !== "none") {
      const removedKeys = [...beforeByTitle.keys()].filter((k) => !afterByTitle.has(k));
      const addedKeys = [...afterByTitle.keys()].filter((k) => !beforeByTitle.has(k));
      const taken = new Set<string>();
      for (const removedKey of removedKeys) {
        const removed = beforeByTitle.get(removedKey);
        if (!removed?.content) continue;
        let match: string | undefined;
        let best = 0;
        for (const addedKey of addedKeys) {
          if (taken.has(addedKey)) continue;
          const added = afterByTitle.get(addedKey);
          if (!added?.content) continue;
          const score =
            added.content === removed.content
              ? 1
              : renameDetection === "similarity"
                ? sectionOverlap(removed.content, added.content)
                : 0;
          if (score > best && (score === 1 || score >= similarityThreshold)) {
            best = score;
            match = addedKey;
          }
        }
        if (match) {
          taken.add(match);
          renamedTo.set(match, removedKey);
        }
      }
    }
    const renamedFrom = new Set(renamedTo.values());

    const seenAfter = new Set<string>();

    for (const [key, afterSection] of afterByTitle) {
      seenAfter.add(key);
      const renamedFromKey = renamedTo.get(key);
      const previous = renamedFromKey ? beforeByTitle.get(renamedFromKey) : undefined;
      if (previous) {
        changes.push({
          section: afterSection.title || "(lead)",
          changeType: "moved",
          fromSection: previous.title || "(lead)",
          fromContent: previous.content,
          toContent: afterSection.content,
        });
        continue;
      }
      const beforeSection = beforeByTitle.get(key);
      if (!beforeSection) {
        changes.push({
          section: afterSection.title || "(lead)",
          changeType: "added",
          toContent: afterSection.content,
        });
      } else if (beforeSection.content !== afterSection.content) {
        changes.push({
          section: afterSection.title || "(lead)",
          changeType: "modified",
          fromContent: beforeSection.content,
          toContent: afterSection.content,
        });
      } else {
        changes.push({
          section: afterSection.title || "(lead)",
          changeType: "unchanged",
        });
      }
    }

    for (const [key, beforeSection] of beforeByTitle) {
      if (!seenAfter.has(key) && !renamedFrom.has(key)) {
        changes.push({
          section: beforeSection.title || "(lead)",
          changeType: "removed",
          fromContent: beforeSection.content,
        });
      }
    }

    return changes;
  },
};

export interface SectionEvent {
  revisionId: number;
  timestamp: string;
  eventType: "created" | "modified" | "removed" | "renamed";
  content?: string;
  oldName?: string;
  newName?: string;
}

export interface SectionLineage {
  sectionName: string;
  level: number;
  firstSeenRevisionId: number;
  firstSeenAt: string;
  lastSeenRevisionId?: number;
  lastSeenAt?: string;
  events: SectionEvent[];
  isActive: boolean;
}

export function buildSectionLineage(
  revisions: Array<{ revId: number; timestamp: string; content: string }>,
  options?: { renameDetection?: "exact" | "similarity" | "none" },
): SectionLineage[] {
  if (revisions.length === 0) return [];

  const allSections = revisions.map((r) => sectionDiffer.extractSections(r.content));

  const lineages = new Map<string, SectionLineage>();

  const firstSections = allSections[0];
  for (const section of firstSections) {
    const key = sectionKey(section);
    lineages.set(key, {
      sectionName: section.title || "(lead)",
      level: section.level,
      firstSeenRevisionId: revisions[0].revId,
      firstSeenAt: revisions[0].timestamp,
      lastSeenRevisionId: revisions[0].revId,
      lastSeenAt: revisions[0].timestamp,
      events: [
        {
          revisionId: revisions[0].revId,
          timestamp: revisions[0].timestamp,
          eventType: "created",
          content: section.content,
        },
      ],
      isActive: true,
    });
  }

  const renameDetection = options?.renameDetection ?? "exact";

  for (let i = 0; i < revisions.length - 1; i++) {
    const prevRev = revisions[i];
    const currRev = revisions[i + 1];

    const prevSections = allSections[i];
    const currSections = allSections[i + 1];

    const prevByKey = new Map<string, Section>();
    const currByKey = new Map<string, Section>();
    for (const s of prevSections) prevByKey.set(sectionKey(s), s);
    for (const s of currSections) currByKey.set(sectionKey(s), s);

    const prevKeys = new Set(prevByKey.keys());
    const currKeys = new Set(currByKey.keys());

    const removedKeys = [...prevKeys].filter((k) => !currKeys.has(k));
    const addedKeys = [...currKeys].filter((k) => !prevKeys.has(k));

    const renamedFromTo = new Map<string, string>();

    if (renameDetection !== "none") {
      const contentToAddKey = new Map<string, string>();
      for (const addKey of addedKeys) {
        const section = currByKey.get(addKey);
        if (!section) continue;
        contentToAddKey.set(section.content, addKey);
      }
      for (const remKey of removedKeys) {
        const remSection = prevByKey.get(remKey);
        if (!remSection) continue;
        const addKey = contentToAddKey.get(remSection.content);
        if (addKey) {
          renamedFromTo.set(remKey, addKey);
        }
      }
    }

    const renamedToSet = new Set(renamedFromTo.values());

    for (const key of removedKeys) {
      if (renamedFromTo.has(key)) {
        const newKey = renamedFromTo.get(key);
        const oldSection = prevByKey.get(key);
        const newSection = newKey ? currByKey.get(newKey) : undefined;
        if (!newKey || !oldSection || !newSection) continue;
        const lineage = lineages.get(key);
        if (lineage) {
          lineage.events.push({
            revisionId: currRev.revId,
            timestamp: currRev.timestamp,
            eventType: "renamed",
            content: oldSection.content,
            oldName: oldSection.title || "(lead)",
            newName: newSection.title || "(lead)",
          });
          lineage.sectionName = newSection.title || "(lead)";
          lineage.level = newSection.level;
          lineage.lastSeenRevisionId = currRev.revId;
          lineage.lastSeenAt = currRev.timestamp;
          lineage.isActive = true;
          lineages.set(newKey, lineage);
          lineages.delete(key);
        }
      } else {
        const section = prevByKey.get(key);
        if (!section) continue;
        const lineage = lineages.get(key);
        if (lineage) {
          lineage.events.push({
            revisionId: currRev.revId,
            timestamp: currRev.timestamp,
            eventType: "removed",
            content: section.content,
          });
          lineage.lastSeenRevisionId = prevRev.revId;
          lineage.lastSeenAt = prevRev.timestamp;
          lineage.isActive = false;
        }
      }
    }

    for (const key of addedKeys) {
      if (!renamedToSet.has(key)) {
        const section = currByKey.get(key);
        if (!section) continue;
        const lineage: SectionLineage = {
          sectionName: section.title || "(lead)",
          level: section.level,
          firstSeenRevisionId: currRev.revId,
          firstSeenAt: currRev.timestamp,
          lastSeenRevisionId: currRev.revId,
          lastSeenAt: currRev.timestamp,
          events: [
            {
              revisionId: currRev.revId,
              timestamp: currRev.timestamp,
              eventType: "created",
              content: section.content,
            },
          ],
          isActive: true,
        };
        lineages.set(key, lineage);
      }
    }

    for (const key of prevKeys) {
      if (currKeys.has(key) && !renamedFromTo.has(key)) {
        const prevSection = prevByKey.get(key);
        const currSection = currByKey.get(key);
        if (!prevSection || !currSection) continue;
        const lineage = lineages.get(key);
        if (lineage) {
          if (prevSection.content !== currSection.content) {
            lineage.events.push({
              revisionId: currRev.revId,
              timestamp: currRev.timestamp,
              eventType: "modified",
              content: currSection.content,
            });
          }
          lineage.lastSeenRevisionId = currRev.revId;
          lineage.lastSeenAt = currRev.timestamp;
          lineage.isActive = true;
        }
      }
    }
  }

  return [...lineages.values()].sort((a, b) => a.sectionName.localeCompare(b.sectionName));
}

/** Share of the two sections' distinct words that both contain. */
function sectionOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let shared = 0;
  for (const w of wordsA) if (wordsB.has(w)) shared++;
  return shared / (wordsA.size + wordsB.size - shared);
}

function sectionKey(s: Section): string {
  return `${s.level}:${s.title.toLowerCase()}`;
}

import { describe, expect, it } from "vitest";
import { locateChange } from "../locate-change.js";
import { definitionHead, sameWording } from "../wording.js";

const OLD = "Pluto is the ninth planet from the Sun.";
const NEW = "Pluto is a dwarf planet in the Kuiper belt.";
const DRAFT = "Pluto is a dwarf planet.";

/** Revision IDs 101.., with each revision's lead given by `leadOf(index)`. */
function history(length: number, leadOf: (index: number) => string) {
  const ids = Array.from({ length }, (_, i) => 101 + i);
  const leads = new Map(ids.map((id, i) => [id, leadOf(i)]));
  const calls: number[][] = [];
  const fetchLeads = async (revisionIds: number[]) => {
    calls.push(revisionIds);
    return new Map(revisionIds.map((id) => [id, leads.get(id) ?? null]));
  };
  return { ids, fetchLeads, calls };
}

/** The new version's wording, compared head to head. */
const hasNewWording = (lead: string | null | undefined) => {
  const head = lead ? definitionHead(lead) : null;
  return head !== null && sameWording(head, definitionHead(NEW) as string);
};

describe("locateChange", () => {
  it("finds the edit that introduced the new wording, reading k candidates per request", async () => {
    const { ids, fetchLeads, calls } = history(300, (i) => (i < 211 ? OLD : NEW));
    const found = await locateChange(ids, hasNewWording, fetchLeads);
    expect(found).toMatchObject({ revisionId: 312, index: 211, value: NEW, previousRevisionId: 311 });
    expect(found?.requests).toBe(calls.length);
    expect(calls.length).toBeLessThanOrEqual(4);
    expect(calls.every((batch) => batch.length <= 8)).toBe(true);
  });

  it("lands on the new version, not on a draft between the old and the new", async () => {
    // A draft at 151..160 is neither the old wording nor the new one. Testing
    // for the old wording's end would date the new version from 151.
    const { ids, fetchLeads } = history(200, (i) => (i < 50 ? OLD : i < 60 ? DRAFT : NEW));
    expect((await locateChange(ids, hasNewWording, fetchLeads))?.revisionId).toBe(161);
    const oldEnded = (lead: string | null | undefined) => lead !== OLD;
    expect((await locateChange(ids, oldEnded, fetchLeads))?.revisionId).toBe(151);
  });

  it("finds the change when vandalism between the samples is removed as reverted states", async () => {
    // 141 introduced the wording; 171 and 172 blanked the lead and 173 put it back.
    const vandalized = new Set([171, 172]);
    const { ids, fetchLeads } = history(100, (i) => (vandalized.has(101 + i) ? "" : i < 40 ? OLD : NEW));
    const candidates = ids.filter((id) => !vandalized.has(id));
    expect((await locateChange(candidates, hasNewWording, fetchLeads))?.revisionId).toBe(141);
  });

  it("can land past the change when a reverted state is left in, which is why they are removed", async () => {
    // With the blanked revisions kept, the change happens twice in the bracket
    // and the search reports the edit that put the wording back.
    const { ids, fetchLeads } = history(9, (i) => (i === 1 ? NEW : i < 1 ? OLD : i < 3 ? "" : NEW));
    const found = await locateChange(ids, hasNewWording, fetchLeads, { k: 1 });
    expect(found?.revisionId).toBe(104);
  });

  it("returns undefined for an empty bracket, without a request", async () => {
    const { fetchLeads, calls } = history(0, () => OLD);
    expect(await locateChange([], hasNewWording, fetchLeads)).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("returns undefined when no candidate is new, so the later sample made the change", async () => {
    const { ids, fetchLeads } = history(20, () => OLD);
    expect(await locateChange(ids, hasNewWording, fetchLeads)).toBeUndefined();
  });

  it("reports a change at the first candidate with no previous candidate", async () => {
    const { ids, fetchLeads } = history(5, () => NEW);
    const found = await locateChange(ids, hasNewWording, fetchLeads);
    expect(found).toMatchObject({ revisionId: 101, index: 0 });
    expect(found).not.toHaveProperty("previousRevisionId");
  });

  it("rejects a k that is not a positive integer", async () => {
    const { ids, fetchLeads } = history(5, () => NEW);
    await expect(locateChange(ids, hasNewWording, fetchLeads, { k: 0 })).rejects.toThrow(RangeError);
  });
});

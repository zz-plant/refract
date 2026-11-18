import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { XmlDumpRevisionSource } from "../xml-dump-source.js";

const SAMPLE_DUMP = `<?xml version="1.0"?>
<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/">
  <page>
    <title>Earth</title>
    <ns>0</ns>
    <id>1</id>
    <revision>
      <id>10</id>
      <timestamp>2026-01-01T00:00:00Z</timestamp>
      <contributor><username>Alice</username><id>100</id></contributor>
      <comment>first revision</comment>
      <text>Hello world</text>
      <sha1>abc</sha1>
    </revision>
    <revision>
      <id>20</id>
      <timestamp>2026-02-01T00:00:00Z</timestamp>
      <contributor><username>Bob</username><id>200</id></contributor>
      <comment>added content</comment>
      <text>Hello world. More content here.</text>
      <sha1>def</sha1>
    </revision>
  </page>
  <page>
    <title>Mars</title>
    <ns>0</ns>
    <id>2</id>
    <revision>
      <id>30</id>
      <timestamp>2026-03-01T00:00:00Z</timestamp>
      <contributor><username>Carol</username><id>300</id></contributor>
      <comment>mars revision</comment>
      <text>Mars content</text>
      <sha1>ghi</sha1>
    </revision>
  </page>
</mediawiki>`;

const SAMPLE_ENTITIES = `<?xml version="1.0"?>
<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/">
  <page>
    <title>Foo &amp; Bar</title>
    <ns>0</ns>
    <id>3</id>
    <revision>
      <id>40</id>
      <timestamp>2026-04-01T00:00:00Z</timestamp>
      <contributor><username>Dave</username><id>400</id></contributor>
      <comment>with &amp; entities</comment>
      <text>Text with &lt;tags&gt; &amp; entities.</text>
      <sha1>jkl</sha1>
    </revision>
  </page>
</mediawiki>`;

describe("XmlDumpRevisionSource", () => {
  it("yields revisions for matching page title", async () => {
    const dir = mkdtempSync(join(tmpdir(), "refract-xml-test-"));
    const filePath = join(dir, "dump.xml");
    writeFileSync(filePath, SAMPLE_DUMP, "utf-8");

    const source = new XmlDumpRevisionSource(filePath);
    const revs: Array<{ revId: number; pageTitle: string; content: string }> = [];
    for await (const rev of source.revisions("Earth")) {
      revs.push(rev);
    }

    rmSync(dir, { recursive: true });

    expect(revs).toHaveLength(2);
    expect(revs[0].revId).toBe(10);
    expect(revs[0].pageTitle).toBe("Earth");
    expect(revs[0].content).toBe("Hello world");
    expect(revs[1].revId).toBe(20);
    expect(revs[1].content).toBe("Hello world. More content here.");
  });

  it("returns empty for non-existent page", async () => {
    const dir = mkdtempSync(join(tmpdir(), "refract-xml-test-"));
    const filePath = join(dir, "dump.xml");
    writeFileSync(filePath, SAMPLE_DUMP, "utf-8");

    const source = new XmlDumpRevisionSource(filePath);
    const revs: Array<unknown> = [];
    for await (const rev of source.revisions("Venus")) {
      revs.push(rev);
    }

    rmSync(dir, { recursive: true });
    expect(revs).toEqual([]);
  });

  it("respects limit option", async () => {
    const dir = mkdtempSync(join(tmpdir(), "refract-xml-test-"));
    const filePath = join(dir, "dump.xml");
    writeFileSync(filePath, SAMPLE_DUMP, "utf-8");

    const source = new XmlDumpRevisionSource(filePath);
    const revs: Array<{ revId: number }> = [];
    for await (const rev of source.revisions("Earth", { limit: 1 })) {
      revs.push(rev);
    }

    rmSync(dir, { recursive: true });
    expect(revs).toHaveLength(1);
    expect(revs[0].revId).toBe(10);
  });

  it("respects timestamp filtering", async () => {
    const dir = mkdtempSync(join(tmpdir(), "refract-xml-test-"));
    const filePath = join(dir, "dump.xml");
    writeFileSync(filePath, SAMPLE_DUMP, "utf-8");

    const source = new XmlDumpRevisionSource(filePath);
    const revs: Array<{ revId: number }> = [];
    for await (const rev of source.revisions("Earth", {
      start: new Date("2026-01-15T00:00:00Z"),
    })) {
      revs.push(rev);
    }

    rmSync(dir, { recursive: true });
    expect(revs).toHaveLength(1);
    expect(revs[0].revId).toBe(20);
  });

  it("handles XML entities in title and content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "refract-xml-test-"));
    const filePath = join(dir, "dump.xml");
    writeFileSync(filePath, SAMPLE_ENTITIES, "utf-8");

    const source = new XmlDumpRevisionSource(filePath);
    const revs: Array<{ revId: number; pageTitle: string; content: string; comment: string }> = [];
    for await (const rev of source.revisions("Foo & Bar")) {
      revs.push(rev);
    }

    rmSync(dir, { recursive: true });

    expect(revs).toHaveLength(1);
    expect(revs[0].revId).toBe(40);
    expect(revs[0].content).toBe("Text with <tags> & entities.");
    expect(revs[0].comment).toBe("with & entities");
  });

  it("reads parent, editor, minor flag, size and withheld text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "refract-xml-test-"));
    const filePath = join(dir, "dump.xml");
    writeFileSync(
      filePath,
      `<mediawiki>
  <page>
    <title>Kaja Kallas</title>
    <id>9</id>
    <revision>
      <id>100</id>
      <timestamp>2026-01-01T00:00:00Z</timestamp>
      <contributor><username>Erin</username><id>5</id></contributor>
      <comment>start &#x2014; draft</comment>
      <text bytes="12" xml:space="preserve">Café opened.</text>
    </revision>
    <revision>
      <id>101</id>
      <parentid>100</parentid>
      <timestamp>2026-01-02T00:00:00Z</timestamp>
      <contributor><ip>192.0.2.1</ip></contributor>
      <minor />
      <text bytes="30" deleted="deleted" />
    </revision>
  </page>
</mediawiki>`,
      "utf-8",
    );
    const source = new XmlDumpRevisionSource(filePath);
    const revs = [];
    for await (const rev of source.revisions("Kaja_Kallas")) revs.push(rev);
    rmSync(dir, { recursive: true });

    expect(revs[0]).toMatchObject({ revId: 100, user: "Erin", minor: false, size: 12, comment: "start — draft" });
    expect(revs[0].parentId).toBeUndefined();
    expect(revs[0].contentAvailable).toBeUndefined();
    // Deleted text is withheld, not an empty page.
    expect(revs[1]).toMatchObject({
      revId: 101,
      parentId: 100,
      user: "192.0.2.1",
      minor: true,
      contentAvailable: false,
    });
  });

  // /<contributor>[\s\S]*?<username>…/ and /<text\b([^>]*?)(\/?)>/ took
  // seconds on revisions like these: quadratic in the openers left unclosed.
  it("stays linear on a revision with many unclosed tags", async () => {
    const dir = mkdtempSync(join(tmpdir(), "refract-xml-test-"));
    const filePath = join(dir, "dump.xml");
    const junk = `<comment>${"<comment>".repeat(20_000)}${"<contributor>".repeat(20_000)}${"<text>".repeat(20_000)}`;
    writeFileSync(
      filePath,
      `<mediawiki><page><title>T</title><id>1</id><revision><id>5</id><timestamp>2026-01-01T00:00:00Z</timestamp>${junk}</revision></page>${"<page><revision>".repeat(20_000)}</mediawiki>`,
      "utf-8",
    );
    const source = new XmlDumpRevisionSource(filePath);
    const t0 = performance.now();
    const revs = [];
    for await (const rev of source.revisions("T")) revs.push(rev);
    const elapsed = performance.now() - t0;
    rmSync(dir, { recursive: true });
    expect(revs).toHaveLength(1);
    expect(revs[0].user).toBeUndefined();
    expect(revs[0].comment).toBe("");
    expect(revs[0].content).toBe("");
    expect(elapsed).toBeLessThan(500);
  });

  it("reads the file once for every page it serves", async () => {
    const dir = mkdtempSync(join(tmpdir(), "refract-xml-test-"));
    const filePath = join(dir, "dump.xml");
    writeFileSync(filePath, SAMPLE_DUMP, "utf-8");
    const source = new XmlDumpRevisionSource(filePath);
    for await (const _ of source.revisions("Earth")) {
      // drain
    }
    rmSync(dir, { recursive: true });
    const mars = [];
    for await (const rev of source.revisions("Mars")) mars.push(rev.revId);
    expect(mars).toEqual([30]);
  });
});

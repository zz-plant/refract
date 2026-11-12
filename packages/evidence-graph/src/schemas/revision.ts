// Revision and diff — raw Wikipedia data types

export interface Revision {
  revId: number;
  parentId?: number; // Source parent when available
  contentAvailable?: boolean; // false when source text was withheld
  pageId: number;
  pageTitle: string;
  timestamp: string; // ISO 8601
  user?: string; // Editor username (may be hidden via oversight)
  comment: string; // Edit summary
  content: string; // Full wikitext
  size: number; // Bytes
  minor: boolean;
}

export interface DiffResult {
  fromRevId: number;
  toRevId: number;
  lines: DiffLine[];
  sections: SectionChange[];
  sizeDelta: number;
}

export interface DiffLine {
  type: "added" | "removed" | "unchanged";
  content: string;
  lineNumber: number;
}

export interface Section {
  title: string;
  level: number; // 1 = lead, 2 = == Section ==, 3 = === Subsection ===
  content: string;
  byteOffset: number;
}

export interface SectionChange {
  section: string;
  changeType: "added" | "removed" | "modified" | "moved" | "unchanged";
  /** For `moved`: the title the section had before it was renamed. */
  fromSection?: string;
  fromContent?: string;
  toContent?: string;
}

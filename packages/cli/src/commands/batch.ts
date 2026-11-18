import { readFileSync } from "node:fs";

/** Page titles from a batch file: one per line, blank lines and lines starting with "#" skipped. */
export function readPagesFile(path: string): string[] {
  return readFileSync(path, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export interface PageOutcome<T> {
  title: string;
  result?: T;
  error?: string;
}

/**
 * Run `work` for each title, at most `concurrency` at a time, and pass each
 * outcome to `emit` in the order the titles were given: as soon as it and
 * every title before it have finished, so output is the same however the
 * requests interleave. A page that fails is passed with its error and does
 * not stop the others. Resolves with how many failed.
 */
export async function forEachPage<T>(
  titles: readonly string[],
  concurrency: number,
  work: (title: string) => Promise<T>,
  emit: (outcome: PageOutcome<T>, index: number) => void,
): Promise<{ failed: number }> {
  const width = Number.isSafeInteger(concurrency) && concurrency > 0 ? concurrency : 1;
  const settled = new Map<number, PageOutcome<T>>();
  let next = 0;
  let emitted = 0;
  let failed = 0;

  const flush = () => {
    for (let outcome = settled.get(emitted); outcome; outcome = settled.get(emitted)) {
      settled.delete(emitted);
      emit(outcome, emitted);
      emitted++;
    }
  };

  const worker = async () => {
    while (next < titles.length) {
      const index = next++;
      const title = titles[index];
      try {
        settled.set(index, { title, result: await work(title) });
      } catch (error) {
        failed++;
        settled.set(index, { title, error: error instanceof Error ? error.message : String(error) });
      }
      flush();
    }
  };

  await Promise.all(Array.from({ length: Math.min(width, titles.length) }, worker));
  return { failed };
}

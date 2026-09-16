import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of the repository root (the directory containing package.json). */
export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** Recursively list files under `dir` whose name ends with one of `extensions`. Returns [] if `dir` is absent. */
export async function listFiles(dir: string, extensions: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return out;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFiles(full, extensions)));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out.sort();
}

/** Directories directly under `dir`; [] if `dir` is absent. */
export async function listSubdirectories(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return [];
    throw error;
  }
}

/** Import specifiers referenced by a TypeScript source text (static and dynamic imports, export-from). */
export function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;
  for (const match of source.matchAll(re)) specs.push(match[1]!);
  return specs;
}

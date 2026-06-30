import { marked } from "marked";

// Docs are plain .md files in src/docs/. They may contain raw HTML (images,
// iframes) — marked passes HTML through, and we render trusted in-repo content.
// Add `<!-- title: Some Title -->` or a leading `# Heading` to name the page;
// `<!-- order: 2 -->` controls sidebar order.
const files = import.meta.glob("../docs/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export interface Doc {
  slug: string;
  title: string;
  order: number;
  html: string;
}

function meta(raw: string, key: string): string | null {
  const m = raw.match(new RegExp(`<!--\\s*${key}:\\s*(.+?)\\s*-->`, "i"));
  return m ? m[1] : null;
}

export const docs: Doc[] = Object.entries(files)
  .map(([path, raw]) => {
    const slug = path.split("/").pop()!.replace(/\.md$/, "");
    const title =
      meta(raw, "title") ?? raw.match(/^#\s+(.+)$/m)?.[1] ?? slug.replace(/-/g, " ");
    const order = Number(meta(raw, "order") ?? 100);
    return { slug, title, order, html: marked.parse(raw) as string };
  })
  .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

export function docBySlug(slug?: string): Doc | undefined {
  return slug ? docs.find((d) => d.slug === slug) : docs[0];
}

import { Link, Navigate, useParams } from "react-router-dom";
import { docs, docBySlug } from "../lib/docs";

export default function Docs() {
  const { slug } = useParams<{ slug: string }>();
  const doc = docBySlug(slug);

  // /docs → redirect to the first page so there's always a slug in the URL.
  if (!slug && docs.length) return <Navigate to={`/docs/${docs[0].slug}`} replace />;

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-white">
              B
            </span>
            Blockwise
          </Link>
          <Link to="/" className="text-sm text-slate-500 hover:text-brand-600">
            ← Back to app
          </Link>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 gap-8 px-4 py-8">
        <nav className="w-48 shrink-0">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Docs
          </div>
          <ul className="space-y-1 text-sm">
            {docs.map((d) => (
              <li key={d.slug}>
                <Link
                  to={`/docs/${d.slug}`}
                  className={`block rounded px-2 py-1 ${
                    d.slug === doc?.slug
                      ? "bg-brand-50 font-medium text-brand-700"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {d.title}
                </Link>
              </li>
            ))}
            {/* /example is its own top-level app, so use a full navigation. */}
            <li className="mt-2 border-t border-slate-100 pt-2">
              <a
                href="/example"
                className="block rounded px-2 py-1 text-brand-600 hover:bg-slate-50"
              >
                Live demo ↗
              </a>
            </li>
          </ul>
        </nav>

        <main className="min-w-0 flex-1">
          {doc ? (
            <article
              className="prose prose-slate max-w-none prose-headings:font-semibold prose-a:text-brand-600"
              dangerouslySetInnerHTML={{ __html: doc.html }}
            />
          ) : (
            <p className="text-slate-400">That doc doesn’t exist.</p>
          )}
        </main>
      </div>
    </div>
  );
}

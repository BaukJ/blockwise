import { Link } from "react-router-dom";
import BmcButton from "../components/BmcButton";

const CONTACT = "bauk.uk+blockwise@outlook.com";

export default function Support() {
  const mailto =
    `mailto:${CONTACT}` +
    `?subject=${encodeURIComponent("Blockwise enquiry")}` +
    `&body=${encodeURIComponent(
      "Hi,\n\n(Feature request / private hosting enquiry — let me know what you need.)\n",
    )}`;

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
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

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-8 px-4 py-10">
        <div>
          <h1 className="text-3xl font-semibold">Support Blockwise</h1>
          <p className="mt-3 text-slate-600">
            Blockwise is <strong>free to use</strong>. It does cost money to run, though
            — servers, storage and email all add up. If it saves you time, a small
            contribution helps keep it online and ad-free for everyone.
          </p>
        </div>

        <section className="card space-y-3">
          <h2 className="font-semibold">Buy me a coffee</h2>
          <p className="text-sm text-slate-500">
            One-off tips are hugely appreciated and go straight towards hosting costs.
          </p>
          <BmcButton />
        </section>

        <section className="card space-y-3">
          <h2 className="font-semibold">Get in touch</h2>
          <p className="text-sm text-slate-500">
            Have a feature request, or want a more tailored solution — like Blockwise
            hosted privately for your school? Drop me a line.
          </p>
          <a href={mailto} className="btn-primary inline-block">
            Contact us
          </a>
          <p className="text-xs text-slate-400">{CONTACT}</p>
        </section>

        <section className="card space-y-2">
          <h2 className="font-semibold">More from bauk.uk</h2>
          <p className="text-sm text-slate-500">
            Blockwise is part of <strong>bauk.uk</strong>. Have a look at the other apps
            and projects.
          </p>
          <a
            href="https://bauk.uk"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-brand-600 hover:underline"
          >
            Visit bauk.uk ↗
          </a>
        </section>
      </main>
    </div>
  );
}

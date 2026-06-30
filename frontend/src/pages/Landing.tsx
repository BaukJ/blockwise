import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Loading } from "../components/Spinner";

const FEATURES = [
  {
    icon: "🧩",
    title: "Optimal block solving",
    body: "An integer-programming solver decides which subjects sit in which block and which class each student joins — honouring as many top choices as possible.",
  },
  {
    icon: "🗂️",
    title: "Flexible choice collection",
    body: "Type choices in, bulk-upload a CSV, or invite students by email to fill in their own — with live progress tracking.",
  },
  {
    icon: "🎚️",
    title: "Rules that fit your school",
    body: "Set blocks, choices and backups per timetable, and add constraints like “choice 1 must be History or Geography”.",
  },
  {
    icon: "🖱️",
    title: "Drag-and-drop layouts",
    body: "Pin classes to specific blocks and let the solver place the rest, or start from a previous run and tweak.",
  },
  {
    icon: "🔁",
    title: "Student reassignment",
    body: "Once finalised, optionally let students swap into classes with free space — their original allocation is always kept.",
  },
  {
    icon: "✉️",
    title: "Magic links & invites",
    body: "Send one-time, time-boxed links so students can submit choices without even creating an account.",
  },
];

const STEPS = [
  ["Create a timetable", "Set your blocks, choices, backups and any rules."],
  ["Add subjects & students", "Enter subjects with class sizes; collect choices your way."],
  ["Run processing", "Generate optimal blocks, review solutions, and finalise."],
  ["Share results", "Students see their allocation; reopen for swaps if you choose."],
];

export default function Landing() {
  const { user, checked, maybeAuthed } = useAuth();

  if (user) {
    if (user.active_role === "teacher") return <Navigate to="/teacher" replace />;
    if (user.active_role === "student") return <Navigate to="/student" replace />;
    return <Navigate to="/choose" replace />;
  }
  if (!checked && maybeAuthed) return <Loading full />;

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <span className="flex items-center gap-2 font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-white">
              B
            </span>
            Blockwise
          </span>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/docs" className="text-slate-600 hover:text-brand-600">
              Docs
            </Link>
            <Link to="/login" className="btn-primary">
              Log in / Sign up
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-5xl px-4 py-16 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Build option blocks students actually want
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-500">
            Blockwise collects students’ ranked subject choices and uses
            integer-linear-programming optimisation to group subjects into timetable
            blocks — maximising how many first and second choices are honoured.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link to="/login" className="btn-primary px-6 py-3 text-base">
              Get started free
            </Link>
            <Link to="/docs" className="btn-ghost px-6 py-3 text-base">
              Read the docs
            </Link>
          </div>
        </section>

        {/* Features */}
        <section className="bg-slate-50 py-16">
          <div className="mx-auto max-w-5xl px-4">
            <h2 className="text-center text-2xl font-semibold">
              Everything you need to run options
            </h2>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="card">
                  <div className="mb-2 text-2xl">{f.icon}</div>
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="mt-1 text-sm text-slate-500">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-5xl px-4 py-16">
          <h2 className="text-center text-2xl font-semibold">How it works</h2>
          <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="card">
                <div className="mb-2 grid h-8 w-8 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">
                  {i + 1}
                </div>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-slate-500">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Who it's for */}
        <section className="bg-slate-50 py-16">
          <div className="mx-auto max-w-3xl px-4 text-center">
            <h2 className="text-2xl font-semibold">Built for schools and colleges</h2>
            <p className="mt-3 text-slate-500">
              Whether you’re placing 30 students or 600 across GCSE or A-level options,
              Blockwise replaces spreadsheets and guesswork with a solver that proves
              the best arrangement — and clear tools for teachers and students alike.
            </p>
            <Link to="/login" className="btn-primary mt-8 inline-block px-6 py-3 text-base">
              Create your first timetable
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-slate-400 sm:flex-row">
          <span>
            Blockwise · timetable block optimisation · © {new Date().getFullYear()}
            <span className="ml-2 text-slate-300">{__APP_VERSION__}</span>
          </span>
          <nav className="flex gap-4">
            <Link to="/docs" className="hover:text-brand-600">
              Docs
            </Link>
            <Link to="/login" className="hover:text-brand-600">
              Log in
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

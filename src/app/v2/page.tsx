import Link from "next/link";

const highlights = [
  {
    title: "Deterministic token flows",
    description: "Replay OIDC exchanges with identical signatures during every run.",
  },
  {
    title: "Ephemeral tenant sandboxes",
    description: "Spin up isolated tenants for CI pipelines in under a second.",
  },
  {
    title: "First-class PKCE testing",
    description: "Validate PKCE challenge exchanges with predictable resolvers.",
  },
  {
    title: "CI-native secrets",
    description: "Bootstrap signing keys and client credentials from typed fixtures.",
  },
];

const highlightColumns = [
  highlights.filter((_, index) => index % 2 === 0),
  highlights.filter((_, index) => index % 2 === 1),
];

const steps = [
  {
    title: "Launch",
    description: "Run `pnpm test:e2e:ci` to provision Postgres + MockAuth auto-magically.",
  },
  {
    title: "Simulate",
    description: "Guide apps through authorize → token → userinfo without leaving localhost.",
  },
  {
    title: "Ship",
    description: "Promote the same configs into preview or production with zero drift.",
  },
];

const integrations = ["OIDC", "OAuth2", "PKCE", "NextAuth", "Logto", "Auth0" ];

export default function LandingV2() {
  const currentYear = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <Link
            href="/v2"
            className="text-lg font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
          >
            MockAuth v2
          </Link>
          <nav className="flex items-center gap-6 text-sm font-semibold">
            <Link
              href="/"
              className="text-slate-200 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
            >
              Version 1
            </Link>
            <Link
              href="/v3"
              className="text-slate-200 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
            >
              Version 3
            </Link>
            <a
              href="https://github.com/agynio/mockauth"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-200 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-32 top-10 h-72 w-72 rounded-full bg-indigo-600/40 blur-3xl" />
            <div className="absolute -top-24 right-0 h-64 w-64 rounded-full bg-violet-500/30 blur-3xl" />
            <div className="absolute bottom-10 left-1/2 h-48 w-48 -translate-x-1/2 rotate-6 rounded-full bg-sky-500/20 blur-3xl" />
          </div>
          <div className="relative mx-auto max-w-6xl px-6 pb-28 pt-32 sm:pb-36 sm:pt-40">
            <div className="max-w-3xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-700/70 bg-slate-900/60 px-4 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-indigo-200">
                Night Mode
              </span>
              <h1 className="mt-8 text-5xl font-semibold tracking-tight text-white sm:text-6xl">
                Run a local identity provider that feels production-ready.
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-slate-200">
                MockAuth mirrors enterprise IdP behavior with deterministic tokens, instant tenant resets, and OIDC coverage your smoke tests can trust.
              </p>
              <div className="mt-12 flex flex-wrap items-center gap-4">
                <a
                  href="#get-started"
                  className="inline-flex items-center justify-center rounded-full bg-white px-7 py-3 text-sm font-semibold text-slate-900 shadow-lg shadow-indigo-900/30 transition hover:bg-indigo-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  Get Started
                </a>
                <a
                  href="https://github.com/agynio/mockauth"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-full border border-white/30 bg-white/10 px-7 py-3 text-sm font-semibold text-white transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  View Repository
                </a>
              </div>
              <div className="mt-6">
                <Link
                  href="/api/auth/signin/logto?callbackUrl=/admin"
                  className="text-sm font-semibold text-indigo-200 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  Sign in to the admin console
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-slate-950">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Why teams adopt MockAuth</h2>
            <div className="mt-12 grid gap-10 md:grid-cols-2 md:gap-16">
              {highlightColumns
                .filter((column) => column.length > 0)
                .map((column, columnIndex) => (
                  <ul
                    key={`highlight-column-${columnIndex}`}
                    className={columnIndex === 1 ? "space-y-6 md:border-l md:border-slate-800 md:pl-12" : "space-y-6"}
                  >
                    {column.map((feature) => (
                      <li key={feature.title} className="flex gap-4">
                        <span className="mt-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-indigo-500 text-base font-semibold text-white shadow shadow-indigo-900/40">
                          ✓
                        </span>
                        <div>
                          <div className="font-semibold text-white">{feature.title}</div>
                          <p className="text-sm text-slate-300">{feature.description}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ))}
            </div>
          </div>
        </section>

        <section className="bg-slate-900">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">How it works</h2>
            <ol className="mt-12 grid gap-10 md:grid-cols-3">
              {steps.map((step, index) => (
                <li key={step.title} className="flex flex-col gap-4">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-2xl font-bold text-white ring-1 ring-white/20">
                    {index + 1}
                  </span>
                  <div className="font-semibold text-white">{step.title}</div>
                  <p className="text-sm text-slate-300">{step.description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="bg-slate-950">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="text-center text-sm font-semibold uppercase tracking-[0.3em] text-indigo-300">Built-in integrations</h2>
            <div className="mt-10 grid gap-6 text-center text-lg font-medium text-slate-200 sm:grid-cols-3">
              {integrations.map((item) => (
                <div key={item} className="rounded-full border border-white/10 bg-white/5 px-6 py-3 backdrop-blur-sm">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-700" id="get-started">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="max-w-3xl">
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Deploy the identity sandbox your pipelines deserve.</h2>
              <p className="mt-4 text-base text-indigo-100">
                Point your OAuth clients at MockAuth to validate redirect guards, signing algorithms, and session lifetimes before your customers ever see them.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <a
                  href="https://github.com/agynio/mockauth"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-full bg-white px-7 py-3 text-sm font-semibold text-indigo-700 shadow-lg shadow-indigo-900/30 transition hover:bg-indigo-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  View on GitHub
                </a>
                <Link
                  href="/"
                  className="inline-flex items-center justify-center rounded-full border border-white/30 bg-white/10 px-7 py-3 text-sm font-semibold text-white transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  Explore Version 1
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-slate-950">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 text-sm text-slate-400">
          <p>© {currentYear} MockAuth</p>
          <a
            href="https://github.com/agynio/mockauth"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-white transition hover:text-indigo-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

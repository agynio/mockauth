import Link from "next/link";

const featureCards = [
  {
    title: "Mock tokens, real spec",
    description: "Every response mirrors RFC-compliant OIDC contracts with predictable signing keys.",
  },
  {
    title: "Declarative tenants",
    description: "Provision tenants + clients from lightweight fixtures that version cleanly.",
  },
  {
    title: "Proxy fallback",
    description: "Bridge to upstream IdPs when you need hybrid traffic without stubbing.",
  },
  {
    title: "Playwright ready",
    description: "Use first-party helpers to spin test sessions and hydrate cookies instantly.",
  },
];

const kpis = [
  { label: "<1 min", description: "from clone to first run" },
  { label: "100%", description: "deterministic test data" },
  { label: "0 drift", description: "between CI & preview" },
];

const faqs = [
  {
    question: "How do I run MockAuth locally?",
    answer:
      "Install dependencies, boot Postgres, then run `pnpm test:e2e:ci` or `pnpm dev` for the playground UI.",
  },
  {
    question: "Does MockAuth support PKCE + refresh tokens?",
    answer:
      "Yes. The authorize/token endpoints mimic an OAuth provider with grant types, refresh rotation, and TTL guardrails.",
  },
  {
    question: "Can I proxy to production while testing?",
    answer:
      "Enable proxy clients to forward requests downstream. MockAuth still records the journey for deterministic assertions.",
  },
];

export default function LandingV3() {
  const currentYear = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
          <Link
            href="/v3"
            className="text-lg font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500"
          >
            MockAuth v3
          </Link>
          <nav className="flex items-center gap-6 text-sm font-semibold">
            <Link
              href="/"
              className="text-slate-700 transition hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500"
            >
              Version 1
            </Link>
            <Link
              href="/v2"
              className="text-slate-700 transition hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500"
            >
              Version 2
            </Link>
            <a
              href="https://github.com/agynio/mockauth"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-700 transition hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500"
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden bg-white pt-28 pb-24 sm:pb-28">
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
            <div className="h-32 w-[36rem] -translate-y-1/2 rounded-full bg-cyan-400/30 blur-3xl" />
          </div>
          <div className="relative mx-auto flex max-w-3xl flex-col items-center px-6 text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/40 px-4 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-600">
              Minimal Identity Sandbox
            </span>
            <h1 className="mt-6 text-5xl font-semibold tracking-tight text-slate-900 sm:text-6xl">
              Provision a realistic auth layer without the vendor baggage.
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-slate-600">
              MockAuth blends deterministic OAuth flows, scripted tenants, and proxy capabilities so your tests can assert every redirect with confidence.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <a
                href="#start"
                className="inline-flex items-center justify-center rounded-full bg-slate-900 px-7 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500"
              >
                Get Started
              </a>
              <a
                href="https://github.com/agynio/mockauth"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-full border border-slate-900 px-7 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-900 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500"
              >
                GitHub
              </a>
            </div>
          </div>
        </section>

        <section className="bg-slate-50">
          <div className="mx-auto max-w-5xl px-6 py-20">
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {featureCards.map((feature) => (
                <div key={feature.title} className="flex flex-col gap-4">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-cyan-400/50 bg-cyan-400/10 text-cyan-600">
                    ▣
                  </span>
                  <div className="font-semibold text-slate-900">{feature.title}</div>
                  <p className="text-sm text-slate-600">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-8 px-6 py-14 text-center sm:text-left">
            {kpis.map((kpi) => (
              <div key={kpi.label} className="flex-1 min-w-[10rem]">
                <div className="text-3xl font-semibold text-slate-900">{kpi.label}</div>
                <div className="mt-2 text-sm uppercase tracking-[0.2em] text-cyan-600">{kpi.description}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-slate-50">
          <div className="mx-auto max-w-3xl px-6 py-20">
            <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Frequently asked questions</h2>
            <div className="mt-10 space-y-4">
              {faqs.map((faq) => (
                <details
                  key={faq.question}
                  className="group rounded-2xl border border-slate-200 bg-white p-6 transition focus-within:border-cyan-400"
                >
                  <summary className="cursor-pointer list-none text-left text-lg font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400">
                    <span className="inline-flex items-center gap-3">
                      <span className="h-1 w-10 bg-cyan-400" aria-hidden="true" />
                      {faq.question}
                    </span>
                  </summary>
                  <p className="mt-4 text-sm leading-relaxed text-slate-600">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-slate-900" id="start">
          <div className="mx-auto max-w-4xl px-6 py-20 text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Bring production-grade auth flows into every pull request.
            </h2>
            <p className="mt-4 text-base text-slate-300">
              MockAuth ships with Playwright helpers, Prisma seeds, and typed services so you can iterate on identity features without waiting on staging environments.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Link
                href="/api/auth/signin/logto?callbackUrl=/admin"
                className="inline-flex items-center justify-center rounded-full bg-white px-7 py-3 text-sm font-semibold text-slate-900 transition hover:bg-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
              >
                Sign in to admin
              </Link>
              <Link
                href="/v2"
                className="inline-flex items-center justify-center rounded-full border border-white/40 px-7 py-3 text-sm font-semibold text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
              >
                Explore the dark variant
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-8 text-sm text-slate-500">
          <p>© {currentYear} MockAuth</p>
          <a
            href="https://github.com/agynio/mockauth"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-slate-900 transition hover:text-cyan-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

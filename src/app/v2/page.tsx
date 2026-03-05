import type { ReactNode } from "react";
import Link from "next/link";

const productionFeatures = [
  {
    title: "OIDC Compliant",
    description:
      "Standard endpoints (discovery, authorize, token, userinfo, JWKS) ensure your application interacts with it exactly as it would with a live identity provider.",
  },
  {
    title: "Secure Auth Flow",
    description:
      "Supports Authorization Code + PKCE—the industry standard for modern web and mobile apps.",
  },
  {
    title: "Redirect Safety",
    description:
      "Enforces strict control over allowed redirect URLs, providing the security verification your app expects.",
  },
];

const developerFeatures = [
  {
    title: "Admin Console",
    description:
      "Manage tenants, clients, and RSA signing keys via a built-in UI (secured by Logto).",
  },
  {
    title: "Multi-Tenant by Design",
    description:
      "Separate namespaces ensure your app-specific configurations never clash across teams or environments.",
  },
  {
    title: "Proxy Mode",
    description:
      "Seamlessly broker OAuth/OIDC requests to an upstream IdP when you need to bridge to production services.",
  },
];

const allFeatures = [...productionFeatures, ...developerFeatures];
const featureSplitIndex = Math.ceil(allFeatures.length / 2);

const featureColumns = [
  allFeatures.slice(0, featureSplitIndex),
  allFeatures.slice(featureSplitIndex),
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

const integrations = ["OIDC", "OAuth2", "PKCE", "NextAuth", "Logto", "Auth0"];

const excellenceItems: { title: string; description: ReactNode }[] = [
  {
    title: "Autonomous Testing",
    description:
      "You’re developing apps that require OIDC login but need to remain completely decoupled from production identity providers.",
  },
  {
    title: "Reliability Engineering",
    description:
      "You require consistent token validation and redirect behavior that remains stable regardless of external provider updates.",
  },
  {
    title: "Rapid Simulation",
    description: (
      <>
        You need to instantly model various authentication scenarios—such as specific scopes or{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-800">email_verified</code>{" "}
        states—without the overhead of manual user provisioning.
      </>
    ),
  },
];

const primaryHeroButtonClasses =
  "inline-flex items-center justify-center rounded-full bg-white px-8 py-4 text-base font-semibold text-indigo-700 shadow-lg shadow-indigo-900/40 transition hover:bg-indigo-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

const secondaryHeroLinkClasses =
  "inline-flex items-center justify-center rounded-full border border-white/70 bg-white/10 px-8 py-4 text-base font-semibold text-white/90 shadow-lg shadow-indigo-900/20 transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

export default function LandingV2() {
  const currentYear = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <Link
            href="/"
            className="text-lg font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            MockAuth
          </Link>
          <a
            href="https://github.com/agynio/mockauth"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-white/90 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            GitHub
          </a>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 text-white">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-32 top-10 h-72 w-72 rounded-full bg-indigo-600/40 blur-3xl" />
            <div className="absolute -top-24 right-0 h-64 w-64 rounded-full bg-violet-500/30 blur-3xl" />
            <div className="absolute bottom-10 left-1/2 h-48 w-48 -translate-x-1/2 rotate-6 rounded-full bg-sky-500/20 blur-3xl" />
          </div>
          <div className="relative mx-auto max-w-6xl px-6 pb-28 pt-32 sm:pb-36 sm:pt-40">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-indigo-100/80">
                Ephemeral identity test rig
              </p>
              <h1 className="mt-6 text-6xl font-bold tracking-tight sm:text-7xl">
                <span className="bg-gradient-to-r from-white via-violet-100 to-white bg-clip-text text-transparent">MockAuth</span>
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-indigo-100/90">
                Frictionless, production-realistic OIDC flows tailored for local development and CI pipelines. Launch a deterministic provider in seconds and validate every redirect, token, and scope with confidence.
              </p>
              <div className="mt-12 flex flex-wrap items-center gap-4">
                <a href="#quick-start" className={primaryHeroButtonClasses}>
                  Get Started
                </a>
                <a
                  href="https://github.com/agynio/mockauth"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={secondaryHeroLinkClasses}
                >
                  View on GitHub
                </a>
              </div>
              <div className="mt-5">
                <Link
                  data-testid="landing-sign-in-link"
                  href="/api/auth/signin/logto?callbackUrl=/admin"
                  className="text-sm font-semibold text-indigo-100 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-slate-950">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Key Features</h2>
            <div className="mt-12 grid gap-10 md:grid-cols-2 md:gap-16">
              {featureColumns
                .filter((column) => column.length > 0)
                .map((column, columnIndex) => (
                  <ul
                    key={`feature-column-${columnIndex}`}
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

        <section className="bg-slate-900">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Where MockAuth Excels</h2>
            <ol className="mt-12 space-y-6 sm:pl-4">
              {excellenceItems.map((item, index) => (
                <li key={item.title} className="flex gap-4">
                  <span className="mt-[6px] inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-indigo-300/60 bg-white/10 text-base font-semibold text-indigo-200">
                    {index + 1}
                  </span>
                  <p className="leading-relaxed text-base text-slate-200">
                    <span className="font-semibold text-white">{item.title}:</span> {item.description}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-700" id="quick-start">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="max-w-3xl">
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Quick Start</h2>
              <p className="mt-4 text-lg leading-relaxed text-indigo-100/90">
                Drop MockAuth into your stack and run the full OIDC suite locally or in CI with a single command.
              </p>
              <div className="mt-10 flex flex-wrap justify-center gap-4">
                <a href="#quick-start" className={primaryHeroButtonClasses}>
                  Get Started
                </a>
                <a
                  href="https://github.com/agynio/mockauth"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={secondaryHeroLinkClasses}
                >
                  View on GitHub
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-slate-950">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-slate-300 sm:flex-row">
          <p>© {currentYear} MockAuth</p>
          <a
            href="https://github.com/agynio/mockauth"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-white/90 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

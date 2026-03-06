import type { ReactNode } from "react";

const frictionPoints = [
  {
    title: "Decouple from External Dependencies",
    description:
      "Stop wrestling with third-party rate limits, latency, or unpredictable service outages during CI/CD. Maintain complete operational independence by running your identity layer as a local, containerized service.",
  },
  {
    title: "On-Demand Environment Provisioning",
    description:
      "Achieve a clean state for every test run. Spin up isolated, pristine instances in seconds to ensure your E2E environment is perfectly synchronized with your application’s state and test data.",
  },
  {
    title: "Guarantee Deterministic Test Cycles",
    description:
      "Eliminate the \"flakiness\" inherent in shared staging environments. Ensure your authentication logic is verified against a stable, version-controlled provider that responds with 100% consistency, every single time.",
  },
];

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

const deployableHighlights = [
  {
    title: "Built for the Stack",
    description: "Next.js + Node + Postgres.",
  },
  {
    title: "CI-Ready",
    description:
      "Includes unit, integration, and E2E tests (Playwright/Vitest) out of the box.",
  },
  {
    title: "Vercel-Optimized",
    description: "Designed for rapid deployment in ephemeral environments.",
  },
];

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

export default function Home() {
  const currentYear = new Date().getFullYear();
  const productionFeatureSplitIndex = Math.ceil(productionFeatures.length / 2);
  const productionFeatureColumns = [
    productionFeatures.slice(0, productionFeatureSplitIndex),
    productionFeatures.slice(productionFeatureSplitIndex),
  ];
  const developerFeatureSplitIndex = Math.ceil(developerFeatures.length / 2);
  const developerFeatureColumns = [
    developerFeatures.slice(0, developerFeatureSplitIndex),
    developerFeatures.slice(developerFeatureSplitIndex),
  ];

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center justify-end px-6 py-6">
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
        <div className="bg-gradient-to-br from-slate-950 via-indigo-900 to-slate-950 text-white">
          <section className="relative overflow-hidden">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute -left-32 top-10 h-72 w-72 rounded-full bg-indigo-400/15 blur-3xl" />
              <div className="absolute -top-24 right-0 h-64 w-64 rounded-full bg-violet-400/15 blur-3xl" />
              <div className="absolute bottom-10 left-1/2 h-48 w-48 -translate-x-1/2 rotate-6 rounded-full bg-indigo-500/10 blur-3xl" />
            </div>
            <div className="relative mx-auto max-w-6xl px-6 pb-28 pt-32 sm:pb-36 sm:pt-40">
              <div className="max-w-3xl">
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-indigo-100/80">
                  Ephemeral identity test rig
                </p>
                <h1 className="mt-6 text-balance text-6xl font-bold tracking-tight sm:text-7xl">
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
              </div>
            </div>
          </section>

          <section>
            <div className="mx-auto max-w-6xl px-6 py-20">
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">The Auth Testing Standard</h2>
              <blockquote className="mt-10 rounded-3xl border border-white/15 bg-white/5 p-10 text-lg leading-8 text-indigo-100/90 shadow-xl shadow-indigo-900/30">
                <span className="block border-l-8 border-white/25 pl-8 italic text-indigo-100">
                  A purpose-built, standards-compliant OIDC identity provider designed for testing. It simulates the behavior of a
                  production authentication server, allowing you to validate sign-ins, token handling, and redirect logic in isolated
                  environments without relying on real user accounts or external services. It is optimized for QA, local development,
                  and ephemeral CI pipelines where you need reliable, repeatable, and clean auth states.
                </span>
              </blockquote>
            </div>
          </section>

          <section>
            <div className="mx-auto max-w-6xl px-6 py-20">
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Eliminate Auth Friction</h2>
              <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-3">
                {frictionPoints.map((point) => (
                  <div
                    key={point.title}
                    className="flex flex-col gap-3 rounded-2xl border border-white/15 bg-white/5 p-8 shadow-lg shadow-black/30 ring-1 ring-white/20"
                  >
                    <h3 className="text-xl font-semibold tracking-tight text-white">{point.title}</h3>
                    <p className="text-base text-indigo-100/90">{point.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section>
            <div className="mx-auto max-w-6xl space-y-20 px-6 py-20">
              <div>
                <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Key Features — Production-Grade Standards
                </h2>
                <div className="mt-12 grid gap-10 md:grid-cols-2 md:gap-16">
                  {productionFeatureColumns
                    .filter((column) => column.length > 0)
                    .map((column, columnIndex) => (
                      <ul
                        key={`production-column-${columnIndex}`}
                        className={
                          columnIndex === 1
                            ? "space-y-6 md:border-l md:border-white/20 md:pl-12"
                            : "space-y-6"
                        }
                      >
                        {column.map((feature) => (
                          <li key={feature.title} className="flex gap-4">
                            <span className="mt-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-base font-semibold text-white ring-1 ring-white/20 shadow shadow-black/30">
                              ✓
                            </span>
                            <div>
                              <div className="font-semibold tracking-tight text-white">{feature.title}</div>
                              <p className="text-sm text-indigo-100/80">{feature.description}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ))}
                </div>
              </div>
              <div>
                <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Key Features — Developer Experience
                </h2>
                <div className="mt-12 grid gap-10 md:grid-cols-2 md:gap-16">
                  {developerFeatureColumns
                    .filter((column) => column.length > 0)
                    .map((column, columnIndex) => (
                      <ul
                        key={`developer-column-${columnIndex}`}
                        className={
                          columnIndex === 1
                            ? "space-y-6 md:border-l md:border-white/20 md:pl-12"
                            : "space-y-6"
                        }
                      >
                        {column.map((feature) => (
                          <li key={feature.title} className="flex gap-4">
                            <span className="mt-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-base font-semibold text-white ring-1 ring-white/20 shadow shadow-black/30">
                              ✓
                            </span>
                            <div>
                              <div className="font-semibold tracking-tight text-white">{feature.title}</div>
                              <p className="text-sm text-indigo-100/80">{feature.description}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ))}
                </div>
              </div>
            </div>
          </section>

          <section>
            <div className="mx-auto max-w-6xl px-6 py-20">
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Deployable Anywhere</h2>
              <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {deployableHighlights.map((item) => (
                  <div
                    key={item.title}
                    className="rounded-2xl border border-white/15 bg-white/5 p-8 shadow-lg shadow-black/30 ring-1 ring-white/20"
                  >
                    <h3 className="text-xl font-semibold tracking-tight text-white">{item.title}</h3>
                    <p className="mt-4 text-base text-indigo-100/90">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section>
            <div className="mx-auto max-w-6xl px-6 py-20">
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Where MockAuth Excels</h2>
              <ol className="mt-12 space-y-6 sm:pl-4">
                {excellenceItems.map((item, index) => (
                  <li key={item.title} className="flex gap-4">
                    <span className="mt-[6px] inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-base font-semibold text-indigo-100">
                      {index + 1}
                    </span>
                    <p className="leading-relaxed text-base text-indigo-100/90">
                      <span className="font-semibold text-white">{item.title}:</span> {item.description}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </div>

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

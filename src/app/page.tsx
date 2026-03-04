import type { ReactNode } from "react";
import Link from "next/link";

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

const primaryButtonClasses =
  "inline-flex items-center justify-center rounded-full bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600";

const secondaryLinkClasses =
  "inline-flex items-center justify-center rounded-full border border-indigo-200 px-6 py-3 text-sm font-semibold text-indigo-700 transition hover:border-indigo-300 hover:text-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600";

export default function Home() {
  const currentYear = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
          <Link
            href="/"
            className="text-lg font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            MockAuth
          </Link>
          <a
            href="https://github.com/agynio/mockauth"
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold text-indigo-700 transition hover:text-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            GitHub
          </a>
        </div>
      </header>
      <main className="flex-1">
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-5xl px-6 py-20">
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">MockAuth</h1>
            <p className="mt-6 max-w-3xl text-lg text-slate-600">
              Frictionless OIDC testing for ephemeral environments.
            </p>
            <div className="mt-10 flex flex-wrap gap-4">
              <a href="#" className={primaryButtonClasses}>
                Get Started
              </a>
              <a
                href="https://github.com/agynio/mockauth"
                target="_blank"
                rel="noreferrer"
                className={secondaryLinkClasses}
              >
                View on GitHub
              </a>
            </div>
            <div className="mt-4">
              <a
                data-testid="landing-sign-in-link"
                href="/api/auth/signin/logto?callbackUrl=/admin"
                className="text-sm font-semibold text-indigo-700 transition hover:text-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                Sign in
              </a>
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-5xl px-6 py-16">
            <h2 className="text-2xl font-semibold text-slate-900">The Auth Testing Standard</h2>
            <blockquote className="mt-6 rounded-2xl border border-indigo-100 bg-white p-8 text-base leading-relaxed text-slate-700 shadow-sm">
              <span className="block border-l-4 border-indigo-500 pl-6">
                A purpose-built, standards-compliant OIDC identity provider designed for testing. It simulates the behavior of a production authentication server, allowing you to validate sign-ins, token handling, and redirect logic in isolated environments without relying on real user accounts or external services. It is optimized for QA, local development, and ephemeral CI pipelines where you need reliable, repeatable, and clean auth states.
              </span>
            </blockquote>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-5xl px-6 py-16">
            <h2 className="text-2xl font-semibold text-slate-900">Eliminate Auth Friction</h2>
            <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
              {frictionPoints.map((point) => (
                <div key={point.title} className="flex flex-col rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-slate-900">{point.title}</h3>
                  <p className="mt-4 text-sm text-slate-700">{point.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-5xl px-6 py-16 space-y-16">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">Key Features — Production-Grade Standards</h2>
              <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
                {productionFeatures.map((feature) => (
                  <div key={feature.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-lg font-semibold text-slate-900">{feature.title}</h3>
                    <p className="mt-4 text-sm text-slate-700">{feature.description}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">Key Features — Developer Experience</h2>
              <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
                {developerFeatures.map((feature) => (
                  <div key={feature.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-lg font-semibold text-slate-900">{feature.title}</h3>
                    <p className="mt-4 text-sm text-slate-700">{feature.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-5xl px-6 py-16">
            <h2 className="text-2xl font-semibold text-slate-900">Deployable Anywhere</h2>
            <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {deployableHighlights.map((item) => (
                <div key={item.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
                  <p className="mt-4 text-sm text-slate-700">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-5xl px-6 py-16">
            <h2 className="text-2xl font-semibold text-slate-900">Where MockAuth Excels</h2>
            <ol className="mt-8 space-y-6 sm:pl-4">
              {excellenceItems.map((item, index) => (
                <li key={item.title} className="flex gap-4">
                  <span className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-indigo-200 bg-white text-sm font-semibold text-indigo-700">
                    {index + 1}
                  </span>
                  <p className="leading-relaxed text-base text-slate-700">
                    <span className="font-semibold text-slate-900">{item.title}:</span> {item.description}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="bg-white">
          <div className="mx-auto max-w-5xl px-6 py-20">
            <div className="rounded-3xl border border-indigo-100 bg-indigo-50 p-10 text-center shadow-sm">
              <h2 className="text-2xl font-semibold text-slate-900">Quick Start</h2>
              <div className="mt-8 flex flex-wrap justify-center gap-4">
                <a href="#" className={primaryButtonClasses}>
                  Get Started
                </a>
                <a
                  href="https://github.com/agynio/mockauth"
                  target="_blank"
                  rel="noreferrer"
                  className={secondaryLinkClasses}
                >
                  View on GitHub
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-slate-600 sm:flex-row">
          <p>
            © {currentYear} MockAuth
          </p>
          <a
            href="https://github.com/agynio/mockauth"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-indigo-700 transition hover:text-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

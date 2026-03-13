import type { ReactNode } from "react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

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
        <code className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-brand-400">email_verified</code>{" "}
        states—without the overhead of manual user provisioning.
      </>
    ),
  },
];

const primaryHeroButtonClasses = cn(
  buttonVariants({ size: "lg" }),
  "bg-cta-gradient text-primary-foreground shadow-xl transition hover:brightness-110 focus-visible:ring-brand-400",
);

const secondaryHeroLinkClasses = cn(
  buttonVariants({ variant: "outline", size: "lg" }),
  "border-border-strong/80 bg-surface-0/10 text-foreground/90 backdrop-blur-sm transition hover:border-brand-400/60 hover:bg-surface-0/20",
);

export default function Home() {
  const currentYear = new Date().getFullYear();

  return (
    <>
      <div className="landing-glow" aria-hidden>
        <div className="landing-glow__layer" data-layer="1" />
        <div className="landing-glow__layer" data-layer="2" />
        <div className="landing-glow__layer" data-layer="3" />
      </div>
      <div className="relative z-10 flex min-h-screen flex-col text-foreground">
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center justify-start px-6 py-6">
          <Link
            href="/"
            className="text-lg font-semibold text-primary-foreground transition hover:text-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            MockAuth
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex-1">
        <section className="relative text-primary-foreground">
          <div className="relative mx-auto max-w-6xl px-6 pb-24 pt-32 sm:pb-32 sm:pt-40">
            <div className="relative z-10 max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-400/80">Ephemeral identity test rig</p>
              <h1 className="mt-6 text-6xl font-bold tracking-tight sm:text-7xl">
                <span className="bg-gradient-to-r from-primary-foreground via-brand-400 to-primary-foreground bg-clip-text text-transparent">
                  MockAuth
                </span>
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-primary-foreground/85">
                Frictionless, production-realistic OIDC flows tailored for local development and CI pipelines. Launch a
                deterministic provider in seconds and validate every redirect, token, and scope with confidence.
              </p>
              <div className="mt-12 flex flex-wrap items-center gap-4">
                <Link href="/api/auth/signin/logto?callbackUrl=%2Fadmin" className={primaryHeroButtonClasses}>
                  Get Started
                </Link>
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
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">The Auth Testing Standard</h2>
            <blockquote className="mt-10 rounded-3xl border border-border bg-surface-2/80 p-10 text-lg leading-8 text-muted-foreground shadow-xl">
              <span className="block border-l-4 border-brand-500/70 pl-8 italic text-foreground/80">
                A purpose-built, standards-compliant OIDC identity provider designed for testing. It simulates the behavior of a
                production authentication server, allowing you to validate sign-ins, token handling, and redirect logic in
                isolated environments without relying on real user accounts or external services. It is optimized for QA, local
                development, and ephemeral CI pipelines where you need reliable, repeatable, and clean auth states.
              </span>
            </blockquote>
          </div>
        </section>

        <section>
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Eliminate Auth Friction</h2>
            <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-3">
              {frictionPoints.map((point) => (
                <div
                  key={point.title}
                  className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-surface-2/90 p-8 shadow-lg ring-1 ring-brand-500/10"
                >
                  <h3 className="text-xl font-semibold text-foreground">{point.title}</h3>
                  <p className="text-base text-muted-foreground">{point.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="mx-auto max-w-6xl space-y-20 px-6 py-20">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Key Features — Production-Grade Standards</h2>
              <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
                {productionFeatures.map((feature) => (
                  <div
                    key={feature.title}
                    className="rounded-2xl border border-border/70 bg-surface-2/90 p-8 shadow-lg ring-1 ring-brand-500/10"
                  >
                    <h3 className="text-xl font-semibold text-foreground">{feature.title}</h3>
                    <p className="mt-4 text-base leading-relaxed text-muted-foreground">{feature.description}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Key Features — Developer Experience</h2>
              <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
                {developerFeatures.map((feature) => (
                  <div
                    key={feature.title}
                    className="rounded-2xl border border-border/70 bg-surface-2/90 p-8 shadow-lg ring-1 ring-brand-500/10"
                  >
                    <h3 className="text-xl font-semibold text-foreground">{feature.title}</h3>
                    <p className="mt-4 text-base leading-relaxed text-muted-foreground">{feature.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Deployable Anywhere</h2>
            <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {deployableHighlights.map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-border/60 bg-surface-2/90 p-8 shadow-lg ring-1 ring-brand-500/10"
                >
                  <h3 className="text-xl font-semibold text-foreground">{item.title}</h3>
                  <p className="mt-4 text-base text-muted-foreground">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Where MockAuth Excels</h2>
            <ol className="mt-12 space-y-6 sm:pl-4">
              {excellenceItems.map((item, index) => (
                <li key={item.title} className="flex gap-4">
                  <span className="mt-[6px] inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-base font-semibold text-brand-400">
                    {index + 1}
                  </span>
                  <p className="leading-relaxed text-base text-muted-foreground">
                    <span className="font-semibold text-foreground">{item.title}:</span> {item.description}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="quick-start">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div
              className="relative overflow-hidden rounded-3xl border border-border p-12 text-center shadow-2xl"
              style={{
                backgroundImage:
                  "linear-gradient(var(--gradient-cta-angle), var(--gradient-cta-start) 0%, var(--gradient-cta-mid) 55%, var(--gradient-cta-end) 100%)",
              }}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage:
                    "radial-gradient(circle at top left, var(--gradient-cta-highlight-start), var(--gradient-cta-highlight-end))",
                }}
              />
              <div className="relative z-10">
                <h2 className="text-3xl font-semibold tracking-tight text-primary-foreground sm:text-4xl">Quick Start</h2>
                <p className="mt-4 text-lg leading-relaxed text-primary-foreground/85">
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
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <p>© {currentYear} MockAuth</p>
          <a
            href="https://github.com/agynio/mockauth"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-muted-foreground transition hover:text-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            GitHub
          </a>
        </div>
      </footer>
      </div>
    </>
  );
}

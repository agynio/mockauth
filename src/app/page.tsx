import type { ReactNode } from "react";
import Link from "next/link";
import TerminalEndpoints from "@/components/TerminalEndpoints";
import type { LucideIcon } from "lucide-react";
import { ShieldCheck, KeyRound, Link as LinkIcon, ServerCog, ArrowRightLeft, Repeat , ArrowRight } from "lucide-react";

import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

const frictionPoints = [
  {
    title: "No dependency on external identity providers",
    description: "Run authentication locally without relying on third-party providers, rate limits, or outages.",
  },
  {
    title: "Spin up auth environments instantly",
    description: "Start a clean OIDC provider in seconds for CI runs, preview environments, or local development.",
  },
  {
    title: "Deterministic authentication flows",
    description: "Ensure tests behave the same every time with predictable tokens, redirects, and scopes.",
  },
];

type CoreFeature = { title: string; description: ReactNode; icon: LucideIcon };

const coreFeatures: CoreFeature[] = [
  { title: "OIDC Compliant", description: (<strong>Standard endpoints: discovery, authorize, token, userinfo, and JWKS.</strong>), icon: ShieldCheck },
  { title: "Auth Code + PKCE", description: "Implements industry-standard flows used by modern SPAs and mobile apps.", icon: KeyRound },
  { title: "Redirect Validation", description: "Strict redirect URI validation to mirror production security rules.", icon: LinkIcon },
  { title: "Admin Console", description: "Manage tenants, clients, and signing keys via a streamlined UI.", icon: ServerCog },
  { title: "Proxy Mode", description: "Forward authentication to real IdPs while preserving local validation rules.", icon: ArrowRightLeft },
  { title: "Deterministic authentication", description: (
    <>
      Predictable tokens and scopes for stable automated tests.
    </>
  ), icon: Repeat },
];

const deployableHighlights = [
  {
    title: "Works in CI pipelines",
    description:
      "Run automated tests with full OIDC flows and predictable authentication.",
  },
  {
    title: "Perfect for preview environments",
    description:
      "Spin up authentication for every deployment without provisioning identity tenants.",
  },
  {
    title: "Simple local development",
    description:
      "Run MockAuth locally and test OAuth/OIDC integrations before production.",
  },
];

const excellenceItems: { title: string; description: ReactNode }[] = [
  {
    title: "Autonomous testing",
    description:
      "Develop apps that require OIDC login without relying on production identity providers.",
  },
  {
    title: "Reliable authentication tests",
    description:
      "Ensure token validation and redirect behavior remain stable regardless of upstream provider changes.",
  },
  {
    title: "Simulating authentication scenarios",
    description:
      "Simulate scopes, identifiers, and claims without manual user provisioning.",
  },
];

const faqItems: { q: string; a: string }[] = [
  { q: "Is MockAuth a production identity provider?", a: "No. It is designed for development, QA, and automated testing environments." },
  { q: "Is it OIDC compliant?", a: "Yes. MockAuth exposes standard OIDC endpoints including discovery, JWKS, and Authorization Code + PKCE." },
  { q: "Can it proxy to a real identity provider?", a: "Yes. Proxy mode allows MockAuth to forward requests to an upstream OIDC provider." },
  { q: "Does it validate redirect URIs?", a: "Yes. Redirect URIs are validated with strict matching by default." },
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
  const currentYear = new Date().getFullYear();  return (
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
      </header>      <main className="relative z-10 flex-1">
        <section className="relative text-primary-foreground">
          <div className="relative mx-auto max-w-[1200px] px-6 py-24 sm:py-32 min-h-screen">
            <div className="grid items-start gap-16 [grid-template-columns:1.1fr_0.9fr]">
              {/* Left column */}
              <div className="w-full max-w-[520px]">
                <h1 className="mt-0 text-5xl font-bold tracking-tight leading-[0.95] sm:text-7xl">
                  <span className="bg-gradient-to-r from-primary-foreground via-brand-400 to-primary-foreground bg-clip-text text-transparent">
                    MockAuth
                  </span>
                </h1>
                <h2 className="mt-4 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
  A mock OpenID Connect provider for QA and automated tests.
</h2>
                <h3 className="mt-4 text-xl leading-[1.7] text-foreground/90">
  Simulate real OIDC authentication — tokens, redirects, and scopes — without running a production identity server.
</h3>
                                <div className="mt-7 flex flex-wrap items-center gap-4">
                  <Link href="/api/auth/signin/logto?callbackUrl=%2Fadmin" className={cn(primaryHeroButtonClasses, "animate-pulse")}>
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

              {/* Right column */}
              <div className="w-full max-w-[460px] self-start">
                <TerminalEndpoints />
              </div>

            </div>
          </div>
        </section>
<section>
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Why MockAuth</h2>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              Testing authentication flows with real identity providers is slow, fragile, and difficult to automate.
              <br />
              MockAuth gives you a predictable OIDC provider designed for QA.
            </p>
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
          <div className="mx-auto max-w-6xl px-6 py-12">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
              <div className="rounded-md border border-slate-700/60 bg-transparent px-3 py-2 text-sm text-foreground/90">
                <div className="font-semibold text-foreground">Your App</div>
                <div className="text-xs text-muted-foreground">web / mobile / SPA</div>
              </div>
              <ArrowRight aria-hidden className="h-5 w-5 text-slate-500" />
              <div className="rounded-md border border-slate-700/60 bg-transparent px-3 py-2 text-sm text-foreground/90">
                <div className="font-semibold text-foreground">MockAuth OIDC</div>
                <div className="text-xs text-muted-foreground">authorize/token/userinfo</div>
              </div>
              <ArrowRight aria-hidden className="h-5 w-5 text-slate-500" />
              <div className="rounded-md border border-slate-700/60 bg-transparent px-3 py-2 text-sm text-foreground/90">
                <div className="font-semibold text-foreground">Backend / API</div>
                <div className="text-xs text-muted-foreground">token validation & sessions</div>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Core Features</h2>
              <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-3">
  {coreFeatures.map((feature) => {
    const Icon = feature.icon;
    return (
      <div key={feature.title} className="flex flex-col text-left">
        <Icon aria-hidden className="h-6 w-6 text-brand-400" />
        <h3 className="mt-4 text-lg font-semibold text-foreground">{feature.title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{feature.description}</p>
      </div>
    );
  })}
</div>
            </div>
</div>
</section>

        <section>
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Designed for real development workflows</h2>
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
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Common Use Cases</h2>
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
        </section>        <section id="quick-start">
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
                  Drop MockAuth into your stack and run full OIDC flows locally or in CI with a single command.
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

        <section>
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">FAQ</h2>
            <dl className="mt-12 space-y-6">
              {faqItems.map((item) => (
                <div key={item.q}>
                  <dt className="text-base font-semibold text-foreground">{item.q}</dt>
                  <dd className="mt-2 text-base leading-relaxed text-muted-foreground">{item.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

      </main>      <footer className="relative z-10 border-t border-border/60">
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

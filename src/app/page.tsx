import Link from "next/link";

const features = [
  "Path-based issuer per tenant (https://host/t/{tenant}/oidc)",
  "Username-only login with isolated cookies",
  "Authorization Code + PKCE (S256) with JWKS per tenant",
  "NextAuth-powered admin console for tenants, clients, keys",
];

export default function Home() {
  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8">
        <p className="text-sm uppercase tracking-wide text-amber-300">Stage 1</p>
        <h1 className="mt-2 text-4xl font-semibold text-white">Mockauth</h1>
        <p className="mt-4 text-lg text-slate-300">
          A multi-tenant mock OpenID Connect provider built for QA and ephemeral environments. Issue codes, sign
          tokens, and exercise PKCE flows without relying on external identity systems.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/admin" className="rounded-md bg-amber-400 px-4 py-2 font-semibold text-slate-900">
            Open admin console
          </Link>
          <a
            href="https://github.com/agynio/mockauth"
            className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200"
            target="_blank"
            rel="noreferrer"
          >
            View repository
          </a>
        </div>
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-950/50 p-8">
        <h2 className="text-2xl font-semibold text-white">What&apos;s included</h2>
        <ul className="mt-4 space-y-2 text-slate-300">
          {features.map((feature) => (
            <li key={feature} className="flex items-start gap-2">
              <span className="mt-1 h-2 w-2 rounded-full bg-amber-400" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

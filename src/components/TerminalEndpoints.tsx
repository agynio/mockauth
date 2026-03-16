"use client";

import { Copy } from "lucide-react";
import { cn } from "@/lib/utils";

const endpoints = [
  {
    label: "Issuer",
    url: "https://mockauth.example.com/r/tenant_qa_default_resource/oidc",
  },
  {
    label: "Discovery",
    url:
      "https://mockauth.example.com/r/tenant_qa_default_resource/oidc/.well-known/openid-configuration",
  },
  {
    label: "Authorize",
    url: "https://mockauth.example.com/r/tenant_qa_default_resource/oidc/authorize",
  },
];

export default function TerminalEndpoints() {
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // optional: surface feedback later
    }
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border",
        "border-brand-700/40 bg-[#020617] shadow-xl ring-1 ring-brand-500/10",
      )}
      aria-labelledby="example-endpoints"
    >
      {/* Window chrome */}
      <div className="flex items-center gap-2 border-b border-brand-700/40 px-4 py-3">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
        <h3 id="example-endpoints" className="ml-4 text-xs font-semibold text-foreground/80">
          Example OIDC endpoints
        </h3>
      </div>

      {/* Body */}
      <div className="p-4">
        <ul className="space-y-5">
          {endpoints.map((e) => (
            <li key={e.label} className="group relative">
              <div className="text-xs font-semibold text-cyan-300">{e.label}</div>
              <code className="mt-1 block overflow-x-auto whitespace-pre font-mono text-sm text-foreground/90">
                {e.url}
              </code>
              <button
                type="button"
                onClick={() => copy(e.url)}
                aria-label={`Copy ${e.label} URL`}
                title={`Copy ${e.label} URL`}
                className={cn(
                  "absolute right-0 top-0 inline-flex h-8 w-8 items-center justify-center rounded-md",
                  "text-foreground/60 hover:text-foreground",
                  "opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100",
                )}
              >
                <Copy className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

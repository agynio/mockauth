"use client";

import { useMemo, useState } from "react";

type Props = {
  label: string;
  value: string;
  description?: string;
};

export function CopyField({ label, value, description }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error("Failed to copy", error);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
        <span>{label}</span>
        {copied && <span className="text-emerald-400">Copied</span>}
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-amber-100">
          {value}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copy ${label}`}
          className="rounded-md border border-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/10"
        >
          Copy
        </button>
      </div>
      {description && <p className="text-xs text-slate-500">{description}</p>}
    </div>
  );
}

type BundleItem = { label: string; value: string };

export function CopyBundleButton({ items, label = "Copy all" }: { items: BundleItem[]; label?: string }) {
  const [copied, setCopied] = useState(false);
  const payload = useMemo(() => {
    return items
      .filter((item) => Boolean(item.value))
      .map((item) => `${item.label}: ${item.value}`)
      .join("\n");
  }, [items]);

  const handleCopy = async () => {
    if (!payload) {
      return;
    }
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error("Failed to copy", error);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!payload}
      aria-label="Copy all OAuth parameters"
      data-testid="oauth-copy-all-btn"
      className="rounded-md border border-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

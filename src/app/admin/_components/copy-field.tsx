"use client";

import { useState } from "react";

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
          className="rounded-md border border-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/10"
        >
          Copy
        </button>
      </div>
      {description && <p className="text-xs text-slate-500">{description}</p>}
    </div>
  );
}

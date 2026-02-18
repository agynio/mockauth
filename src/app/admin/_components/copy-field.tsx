"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: string;
  description?: string;
  testId?: string;
};

export function CopyField({ label, value, description, testId }: Props) {
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
    <div className="space-y-2" data-testid={testId} data-field-label={label}>
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <span
          aria-live="polite"
          className={cn("text-primary transition-opacity", copied ? "opacity-100" : "opacity-0")}
        >
          Copied
        </span>
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-md border bg-muted/50 px-3 py-2 font-mono text-sm text-foreground/80">
          {value}
        </code>
        <Button type="button" variant="outline" size="icon" onClick={handleCopy} aria-label={`Copy ${label}`}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

type BundleItem = { label: string; value: string };

export function CopyBundleButton({
  items,
  label = "Copy all",
  testId = "oauth-copy-all-btn",
  ariaLabel,
}: {
  items: BundleItem[];
  label?: string;
  testId?: string;
  ariaLabel?: string;
}) {
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
    <Button
      type="button"
      variant="outline"
      onClick={handleCopy}
      disabled={!payload}
      aria-label={ariaLabel ?? label}
      data-testid={testId}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}

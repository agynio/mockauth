"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = {
  initialQuery: string;
};

export function ClientSearchInput({ initialQuery }: Props) {
  const [value, setValue] = useState(initialQuery);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const mounted = useRef(false);
  const paramsSnapshot = searchParams?.toString() ?? "";

  useEffect(() => {
    setValue(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const timeout = setTimeout(() => {
      startTransition(() => {
        const params = new URLSearchParams(paramsSnapshot);
        if (value) {
          params.set("q", value);
        } else {
          params.delete("q");
        }
        params.delete("page");
        const qs = encodeQuery(params);
        router.replace(qs ? `${pathname}?${qs}` : pathname);
      });
    }, 400);
    return () => clearTimeout(timeout);
  }, [value, pathname, router, paramsSnapshot, startTransition]);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search clients"
        aria-label="Search clients"
        className="pl-9 pr-10"
        data-testid="clients-search-input"
      />
      <Loader2
        className={cn(
          "absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground",
          pending ? "opacity-100" : "opacity-0",
        )}
        aria-hidden={!pending}
      />
    </div>
  );
}

const encodeQuery = (params: URLSearchParams) =>
  Array.from(params.entries())
    .map(([key, paramValue]) => `${encodeURIComponent(key)}=${encodeURIComponent(paramValue)}`)
    .join("&");

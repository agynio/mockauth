"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  description?: string;
};

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <ul className="space-y-1.5">
      {items.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              className={cn(
                buttonVariants({ variant: isActive ? "secondary" : "ghost" }),
                "w-full justify-start gap-2 px-4 py-3 text-left",
                isActive ? "shadow-sm" : "text-muted-foreground",
              )}
            >
              <div className="flex flex-col">
                <span className="text-sm font-semibold">{item.label}</span>
                {item.description ? <span className="text-xs text-muted-foreground">{item.description}</span> : null}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

import type { ReactNode } from "react";

export const metadata = {
  title: "Mockauth Admin",
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}

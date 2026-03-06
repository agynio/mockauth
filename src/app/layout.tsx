import type { Metadata } from "next";
import localFont from "next/font/local";

import "./globals.css";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

const geistSans = localFont({
  src: [
    {
      path: "../../public/fonts/GeistSans-Variable.woff2",
      style: "normal",
    },
  ],
  variable: "--font-geist-sans",
});

const geistMono = localFont({
  src: [
    {
      path: "../../public/fonts/GeistMono-Variable.woff2",
      style: "normal",
    },
  ],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Mockauth",
  description: "Multi-tenant mock OIDC provider for QA environments",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(geistSans.variable, geistMono.variable)} suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          {children}
        </ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
}

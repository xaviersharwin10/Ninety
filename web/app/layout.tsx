import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { AccountProvider } from "@/lib/account-context";
import { AuthProvider } from "@/lib/auth-context";

const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const display = Bebas_Neue({
  variable: "--font-display",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ninety",
  description:
    "Every minute of a live football match becomes a market — priced by competing AI agents, settled onchain on Monad.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#06070a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} h-full`}>
      <body className="min-h-full">
        <AuthProvider>
          <AccountProvider>
            <AppShell>{children}</AppShell>
          </AccountProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

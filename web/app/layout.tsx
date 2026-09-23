import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Inter } from "next/font/google";
import "./globals.css";
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
          <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col md:my-6 md:min-h-[calc(100dvh-3rem)] md:rounded-[32px] md:border md:border-border md:shadow-[0_0_120px_-20px_rgba(124,108,255,0.25)]">
            {children}
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}

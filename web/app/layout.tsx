import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Inter } from "next/font/google";
import "./globals.css";
import { DesktopNav } from "@/components/DesktopNav";
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
          <div className="mx-auto flex w-full max-w-[1280px] flex-col md:min-h-dvh md:flex-row md:gap-10 md:px-10 md:py-10">
            <DesktopNav />
            <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-1 flex-col md:mx-0 md:max-w-none md:min-h-0">
              {children}
            </div>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}

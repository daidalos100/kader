import type { Metadata } from "next";
import { Days_One, Onest } from "next/font/google";
import "./globals.css";

const onest = Onest({
  variable: "--font-onest",
  subsets: ["latin"],
  display: "swap",
});

const daysOne = Days_One({
  variable: "--font-days-one",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TSG Tübingen D1 · Coaching Tool",
  description: "Kalender, Kaderplanung, Anwesenheit und Statistik der TSG Tübingen D1.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/brand/tsg-logo.png",
    shortcut: "/brand/tsg-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className={onest.variable + " " + daysOne.variable + " antialiased"}>
        {children}
      </body>
    </html>
  );
}

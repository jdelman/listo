import type { Metadata } from "next";
import "./globals.css";
import { ActionLogging } from "./action-logging";

export const metadata: Metadata = {
  title: "Home — Listo",
  description: "Capture, organize, find, and export mixed-media lists.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><head><link rel="stylesheet" href="https://use.typekit.net/sfm7ncz.css" /></head><body><ActionLogging />{children}</body></html>;
}

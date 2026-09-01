import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Listo — personal lists",
  description: "Capture, organize, find, and export mixed-media lists.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

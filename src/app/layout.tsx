import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VyaparVani — bolo, samajh gaya, likh diya",
  description:
    "Voice-first inventory, order and khata assistant for India's small retailers. Speak in Hinglish; VyaparVani writes the entry.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="hi-Latn">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

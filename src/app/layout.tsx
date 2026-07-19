import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spec Grill",
  description: "Turn a vague product request into a traceable specification.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

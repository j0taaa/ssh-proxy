import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SSH Proxy Scaffold",
  description: "Scaffold placeholder for the browser SSH proxy project",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

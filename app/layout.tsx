import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Armazada Publisher",
  description: "Private bulk publisher for @armazada.atlantic.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl">
      <body className="antialiased">{children}</body>
    </html>
  );
}

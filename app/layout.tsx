import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MSTP Dynasty",
  description: "Live tracker and roast desk for the MSTP Dynasty fantasy league.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

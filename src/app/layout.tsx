import type { Metadata } from "next";
import "./globals.css";
import "./reading-workspace.css";

export const metadata: Metadata = {
  title: "AgentProof",
  description: "Evidence-based verification reports for AI-generated pull requests"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

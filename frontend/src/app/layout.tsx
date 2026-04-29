import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "USDC Bridge",
  description: "Bridge USDC between chains",
  icons: {
    icon: [
      { url: "/logo1.png", sizes: "32x32", type: "image/png" },
      { url: "/logo1.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/logo1.png",
    apple: [
      { url: "/logo1.png", sizes: "180x180", type: "image/png" },
    ],
  },
  openGraph: {
    title: "USDC Bridge",
    description: "Bridge USDC between chains",
    images: [{ url: "/logo1.png" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
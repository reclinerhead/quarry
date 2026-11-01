import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Courier_Prime, Zilla_Slab } from "next/font/google";
import { TopBar } from "@/components/topbar";
import "./globals.css";

// The faces design/DESIGN.md §3 names: Zilla Slab for names, headings and big
// numbers; Atkinson Hyperlegible, made for low-vision readers, for everything
// else; Courier Prime for what a collector would type on a label. Self-hosted
// at build time by next/font; the variables feed the font tokens in
// design/tokens.css, so the stations make no font requests.
const zilla = Zilla_Slab({
  variable: "--font-zilla",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const atkinson = Atkinson_Hyperlegible({
  variable: "--font-atkinson",
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
});

const courier = Courier_Prime({
  variable: "--font-courier",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "The Quarry",
  description: "A living inventory of the rocks, minerals, and crystals in a household, built from photos taken on a phone.",
};

export const viewport: Viewport = {
  themeColor: "#F5F1EA",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${zilla.variable} ${atkinson.variable} ${courier.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-ground font-sans text-body leading-normal text-ink">
        <TopBar />
        {children}
      </body>
    </html>
  );
}

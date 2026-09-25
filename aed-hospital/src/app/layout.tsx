import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AED Hospital · Finance & Analytics", template: "%s · AED Hospital" },
  description: "Income, expenditure, accounting and operational analytics for AED Hospital, KPHB, Hyderabad",
  applicationName: "AED Finance",
  appleWebApp: { capable: true, title: "AED Finance", statusBarStyle: "default" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/icon-192.png" },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1e5ae0" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1115" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen antialiased">
        {children}
        <script
          // Register the service worker (app-shell only; financial API data is never cached).
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost')){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}`,
          }}
        />
      </body>
    </html>
  );
}

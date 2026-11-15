import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { currentUser } from "@/lib/server.ts";
import { logoutAction } from "./actions.ts";

export const metadata: Metadata = {
  title: "Bidwell · Auctions for pre-loved goods",
  description: "Bid on used items and have them shipped to your door.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body>
        <header className="site">
          <div className="container">
            <Link href="/" className="brand">
              Bid<span>well</span>
            </Link>
            <nav className="main">
              <Link href="/">Browse</Link>
              <Link href="/sell">Sell an item</Link>
              {user ? (
                <>
                  {user.isAdmin && <Link href="/admin">Admin</Link>}
                  <Link href="/account">My account</Link>
                  <form action={logoutAction}>
                    <button className="btn link">Sign out</button>
                  </form>
                </>
              ) : (
                <>
                  <Link href="/login">Sign in</Link>
                  <Link href="/register" className="btn primary" style={{ padding: "6px 12px", color: "var(--accent-ink)" }}>
                    Join
                  </Link>
                </>
              )}
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}

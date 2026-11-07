import Link from "next/link";

const GOLD_BUTTON = "rounded-full bg-gold font-bold text-ink no-underline hover:bg-gold-light";

function Logo() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M4 15 16 4l12 11" stroke="#a97c12" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 13v14.5h17V13" stroke="#1f5a41" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M16 23.5s-4.5-2.7-4.5-5.7a2.4 2.4 0 0 1 4.5-1.2 2.4 2.4 0 0 1 4.5 1.2c0 3-4.5 5.7-4.5 5.7Z"
        fill="#d4a017"
      />
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 p-6">
      <Link href="/" className="flex items-center gap-2.5 no-underline">
        <Logo />
        <span className="font-display text-2xl font-semibold">MicroMatch</span>
      </Link>
      <nav aria-label="Main" className="flex flex-wrap items-center gap-6 text-base font-semibold text-forest">
        <Link href="/#why" className="hover:text-gold-deep max-sm:hidden">Why MicroMatch</Link>
        <Link href="/how-it-works" className="hover:text-gold-deep">How it works</Link>
        <Link href="/#get" className={`${GOLD_BUTTON} px-5 py-2.5`}>Get the extension</Link>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 px-6 pb-10 text-sm text-muted">
      <span>MicroMatch, built at the Microburbs Hackathon 2026.</span>
      <span>Property and suburb data from Microburbs. Scores are a guide, not financial advice.</span>
    </footer>
  );
}

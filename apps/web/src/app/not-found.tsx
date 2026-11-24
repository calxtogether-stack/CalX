import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-full flex-col items-center justify-center bg-[var(--bg-primary)] p-6 text-center text-[var(--text-primary)]">
      <h1 className="text-lg font-semibold">Page Not Found</h1>
      <Link
        href="/"
        className="mt-3 rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs hover:bg-[var(--bg-secondary)]"
      >
        Return to Calculator
      </Link>
    </main>
  );
}

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold text-brand-700">Raccoon CRM</h1>
      <p className="text-slate-600">Phase 0 bootstrap is live.</p>
      <p className="text-sm text-slate-500">
        API:{' '}
        <a
          className="underline hover:text-brand-600"
          href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/health`}
          target="_blank"
          rel="noreferrer"
        >
          /health
        </a>
      </p>
    </main>
  );
}

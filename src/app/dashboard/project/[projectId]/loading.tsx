export default function ProjectEditorLoading() {
  return (
    <section className="grid min-h-[100dvh] gap-4 px-6 py-8 lg:grid-cols-[280px_1fr_320px] lg:px-10">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="h-[70vh] animate-pulse rounded-3xl border border-line/10 bg-layer/5" />
      ))}
    </section>
  );
}

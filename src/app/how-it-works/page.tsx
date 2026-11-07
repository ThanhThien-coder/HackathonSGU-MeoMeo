import { HowItWorksHero } from "../../components/how-it-works/HowItWorksHero";

export default function HowItWorksPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-10 sm:px-6 sm:py-16">
      <HowItWorksHero />

      <section aria-labelledby="learning-steps-title">
        <h2 id="learning-steps-title" className="mb-4 text-xl font-semibold">
          Bốn bước học
        </h2>
        <ol className="grid gap-4 sm:grid-cols-2">
          {[1, 2, 3, 4].map((step) => (
            <li
              key={step}
              className="rounded-lg border border-neutral-300 p-4 text-sm font-medium dark:border-neutral-700"
            >
              Bước {step}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

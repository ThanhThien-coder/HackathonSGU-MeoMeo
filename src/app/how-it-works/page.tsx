import { FourStepsSection } from "../../components/how-it-works/FourStepsSection";
import { HowItWorksHero } from "../../components/how-it-works/HowItWorksHero";

export default function HowItWorksPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-10 sm:px-6 sm:py-16">
      <HowItWorksHero />
      <FourStepsSection />
    </main>
  );
}

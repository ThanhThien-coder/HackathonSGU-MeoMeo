import { SWE_SKILLS } from "@/contracts/base";
import { CONCEPT_CARDS } from "./concept-cards";

export function ConceptCardsSection() {
  return (
    <section aria-labelledby="concept-cards-title">
      <h2 id="concept-cards-title" className="mb-4 text-xl font-semibold">
        16 khái niệm khi đọc mã nguồn
      </h2>
      <ul className="grid gap-4 sm:grid-cols-2">
        {SWE_SKILLS.map((skill) => {
          const card = CONCEPT_CARDS[skill];

          return (
            <li key={skill} className="min-w-0 rounded-lg border border-line bg-panel p-4">
              <h3 className="font-semibold">{card.name_vi}</h3>
              <code className="mt-1 block text-xs break-all text-muted">
                {card.skill}
              </code>
              <dl className="mt-4 space-y-3 text-sm leading-relaxed">
                <div>
                  <dt className="font-medium">Là gì</dt>
                  <dd className="mt-1 text-muted">{card.what}</dd>
                </div>
                <div>
                  <dt className="font-medium">Ví dụ đời thường</dt>
                  <dd className="mt-1 text-muted">{card.analogy}</dd>
                </div>
                <div>
                  <dt className="font-medium">Vì sao quan trọng</dt>
                  <dd className="mt-1 text-muted">{card.why}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

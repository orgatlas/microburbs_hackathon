import { CATEGORIES, METRIC_LABELS, type Points, percent } from "@/lib/quiz";

export function WeightBreakdown({ weights }: { weights: Points }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {CATEGORIES.map((category) => {
        const share = category.metrics.reduce((sum, metric) => sum + weights[metric], 0);
        return (
          <section key={category.key} className="flex flex-col gap-2.5 rounded-2xl border border-sand bg-paper p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-xl font-bold">{category.label}</h2>
              <span className="font-display text-3xl font-semibold">{percent(share)}</span>
            </div>
            {category.metrics.map((metric) => (
              <div key={metric} className="text-base">
                <div className="flex justify-between gap-3">
                  <span>{METRIC_LABELS[metric]}</span>
                  <strong>{percent(weights[metric])}</strong>
                </div>
                <div className="h-2 rounded-full bg-sand/60">
                  <div
                    className={`h-2 rounded-full ${category.bar}`}
                    style={{ width: `${Math.min(100, weights[metric] * 400)}%` }}
                  />
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

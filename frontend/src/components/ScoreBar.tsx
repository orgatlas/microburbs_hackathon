type ScoreBarProps = {
  label: string;
  score: number;
};

export function ScoreBar({ label, score }: ScoreBarProps) {
  return (
    <div>
      <div className="flex justify-between gap-3">
        <span>{label}</span>
        <strong>{score}</strong>
      </div>
      <div className="h-2 rounded-full bg-sand">
        <div
          className="h-2 rounded-full bg-forest transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

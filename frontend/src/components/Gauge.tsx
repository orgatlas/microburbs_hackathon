type GaugeProps = {
  score: number;
  className?: string;
  decorative?: boolean;
};

// Each arc is one score band, ending at 40, 60, 80 and 100 on the 180 degree dial.
const BANDS = [
  { path: "M24 120A96 96 0 0 1 90.3 28.7", className: "stroke-sand" },
  { path: "M90.3 28.7A96 96 0 0 1 149.7 28.7", className: "stroke-gold" },
  { path: "M149.7 28.7A96 96 0 0 1 197.7 63.6", className: "stroke-sage" },
  { path: "M197.7 63.6A96 96 0 0 1 216 120", className: "stroke-forest" },
];

export function Gauge({ score, className, decorative = false }: GaugeProps) {
  const label = decorative
    ? { "aria-hidden": true }
    : { role: "img", "aria-label": `Speedometer gauge with the needle at ${score} out of 100` };

  return (
    <svg viewBox="0 0 240 134" className={className} {...label}>
      <g fill="none" strokeWidth="18">
        {BANDS.map((band) => (
          <path key={band.path} d={band.path} className={band.className} />
        ))}
      </g>
      <g
        className="transition-transform duration-500 ease-out motion-reduce:transition-none"
        style={{ transform: `rotate(${score * 1.8}deg)`, transformOrigin: "120px 120px" }}
      >
        <path d="M120 115 44 120l76 5Z" className="fill-ink" />
      </g>
      <circle cx="120" cy="120" r="10" className="fill-ink" />
    </svg>
  );
}

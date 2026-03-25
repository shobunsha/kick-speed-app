type MetricCardProps = {
  label: string;
  value: string;
  subValue?: string;
};

export function MetricCard({ label, value, subValue }: MetricCardProps) {
  return (
    <article className="metricCard">
      <p>{label}</p>
      <strong>{value}</strong>
      {subValue && <span>{subValue}</span>}
    </article>
  );
}

export interface FilterOption {
  value: string;
  label: string;
}

interface Props {
  label: string;
  value: string | null;
  options: FilterOption[];
  onChange: (value: string | null) => void;
  title?: string;
}

export function FilterSelect({ label, value, options, onChange, title }: Props) {
  return (
    <select
      className="field"
      aria-label={label}
      title={title}
      value={value ?? ''}
      onChange={(e) => {
        onChange(e.target.value === '' ? null : e.target.value);
      }}
    >
      <option value="">{`${label}: all`}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

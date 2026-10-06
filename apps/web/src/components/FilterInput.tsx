interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function FilterInput({ label, value, onChange, placeholder }: Props) {
  return (
    <input
      type="search"
      className="field"
      data-search=""
      aria-label={label}
      placeholder={placeholder ?? label}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
      }}
    />
  );
}

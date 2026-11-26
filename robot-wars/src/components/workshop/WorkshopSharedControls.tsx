type NumericInputProps = {
  value: number;
  onValidChange: (value: number) => void;
  min?: number;
  step?: number;
};

export function NumericInput({
  value,
  onValidChange,
  min,
  step = 0.1,
}: NumericInputProps) {
  return (
    <input
      type="number"
      min={min}
      step={step}
      value={value}
      onChange={(event) => {
        const nextDraft = event.target.value;

        if (nextDraft.trim() === "") return;

        const nextValue = Number(nextDraft);
        if (!Number.isFinite(nextValue)) return;
        if (min !== undefined && nextValue < min) return;

        onValidChange(nextValue);
      }}
      onBlur={(event) => {
        const nextValue = Number(event.currentTarget.value);

        if (
          event.currentTarget.value.trim() === "" ||
          !Number.isFinite(nextValue) ||
          (min !== undefined && nextValue < min)
        ) {
          event.currentTarget.value = String(value);
        }
      }}
    />
  );
}

export function VisibilityIcon({ visible }: { visible: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {visible ? (
        <>
          <path d="M1.5 8s2.2-4.5 6.5-4.5S14.5 8 14.5 8 12.3 12.5 8 12.5 1.5 8 1.5 8Z" />
          <circle cx="8" cy="8" r="1.8" />
        </>
      ) : (
        <>
          <path d="M2 5.2C1.7 5.6 1.5 6 1.5 6s2.2 4.5 6.5 4.5c1 0 1.9-.3 2.7-.7M5.2 3.8A6.2 6.2 0 0 1 8 3.2c4.3 0 6.5 4.5 6.5 4.5s-.5 1-1.6 2" />
          <path d="m2 2 12 12" />
        </>
      )}
    </svg>
  );
}

import React from "react";

type Option = { value: string; label: string };

type ContextValue = {
  value: string;
  onValueChange: (next: string) => void;
  registerOption: (option: Option) => void;
  options: Option[];
  disabled: boolean;
};

const SelectContext = React.createContext<ContextValue | null>(null);

const Select = ({ value, defaultValue, onValueChange, disabled = false, children }: any) => {
  const [options, setOptions] = React.useState<Option[]>([]);
  const [currentValue, setCurrentValue] = React.useState<string>(value ?? defaultValue ?? "");
  React.useEffect(() => {
    if (value !== undefined) {
      setCurrentValue(value);
    }
  }, [value]);
  const registerOption = (option: Option) => {
    setOptions((prev) => {
      const existing = prev.find((item) => item.value === option.value);
      if (existing && existing.label === option.label) {
        return prev;
      }
      const next = prev.filter((item) => item.value !== option.value);
      return [...next, option];
    });
  };
  const handleChange = (next: string) => {
    setCurrentValue(next);
    onValueChange?.(next);
  };
  return (
    <SelectContext.Provider value={{ value: currentValue, onValueChange: handleChange, registerOption, options, disabled }}>
      {children}
    </SelectContext.Provider>
  );
};

const SelectTrigger = ({ id, "data-testid": dataTestId, "aria-label": ariaLabel, disabled, ...rest }: any) => {
  const context = React.useContext(SelectContext);
  if (!context) return null;
  return (
    <select
      id={id}
      data-testid={dataTestId}
      aria-label={ariaLabel}
      value={context.value ?? ""}
      onChange={(event) => context.onValueChange(event.target.value)}
      disabled={context.disabled || disabled}
      {...rest}
    >
      {context.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
};

const SelectContent = ({ children }: any) => <>{children}</>;

const SelectItem = ({ value, children }: any) => {
  const context = React.useContext(SelectContext);
  React.useEffect(() => {
    context?.registerOption({ value, label: String(children) });
  }, [context, value, children]);
  return null;
};

const SelectValue = ({ children }: any) => <>{children}</>;
const SelectGroup = ({ children }: any) => <>{children}</>;
const SelectLabel = ({ children }: any) => <>{children}</>;
const SelectSeparator = () => null;

export { Select, SelectTrigger, SelectContent, SelectItem, SelectValue, SelectGroup, SelectLabel, SelectSeparator };

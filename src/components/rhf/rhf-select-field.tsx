"use client";

import * as React from "react";
import type { Control, FieldPath, FieldValues } from "react-hook-form";

import { cn } from "@/lib/utils";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type SelectRootProps = React.ComponentPropsWithoutRef<typeof Select>;
type SelectTriggerProps = React.ComponentPropsWithoutRef<typeof SelectTrigger>;
type SelectContentProps = React.ComponentPropsWithoutRef<typeof SelectContent>;
type SelectItemProps = React.ComponentPropsWithoutRef<typeof SelectItem>;

export type RHFSelectOption<TValue extends string> = {
  value: TValue;
  label: React.ReactNode;
  itemProps?: Omit<SelectItemProps, "value">;
};

type RHFSelectFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
  TValue extends string,
> = {
  control: Control<TFieldValues>;
  name: TName;
  label?: React.ReactNode;
  placeholder?: string;
  description?: React.ReactNode;
  options: ReadonlyArray<RHFSelectOption<TValue>>;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  contentProps?: Omit<SelectContentProps, "children">;
  onValueChange?: (value: TValue) => void;
} & Omit<SelectRootProps, "value" | "defaultValue" | "onValueChange" | "children"> &
  Partial<Pick<SelectTriggerProps, "id" | "name">>;

export function RHFSelectField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
  TValue extends string,
>({
  control,
  name,
  label,
  placeholder,
  description,
  options,
  disabled,
  className,
  triggerClassName,
  contentProps,
  onValueChange,
  id,
  name: triggerName,
  ...selectProps
}: RHFSelectFieldProps<TFieldValues, TName, TValue>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const isDisabled = disabled ?? false;
        const triggerAriaLabel = typeof label === "string" ? label : undefined;

        return (
          <FormItem className={className}>
            {label ? <FormLabel>{label}</FormLabel> : null}
            <FormControl>
              <Select
                {...selectProps}
                value={field.value}
                onValueChange={(nextValue) => {
                  field.onChange(nextValue);
                  field.onBlur();
                  onValueChange?.(nextValue as TValue);
                }}
                disabled={isDisabled}
              >
                <SelectTrigger
                  id={id}
                  name={triggerName}
                  className={cn("justify-between", triggerClassName)}
                  aria-label={triggerAriaLabel}
                  data-selected-value={field.value as string | undefined}
                  disabled={isDisabled}
                >
                  <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent {...contentProps}>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value} {...option.itemProps}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormControl>
            {description ? <FormDescription>{description}</FormDescription> : null}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

import { Input, type InputProps } from "../atoms/Input";
import { cn } from "../utils/cn";
import { Search, type LucideIcon } from "lucide-react";

export type SearchInputProps = InputProps & {
  wrapperClassName?: string;
  icon?: LucideIcon;
};

export function SearchInput({
  className,
  wrapperClassName,
  icon: Icon = Search,
  ...props
}: SearchInputProps) {
  return (
    <div className={cn("relative", wrapperClassName)}>
      <Input className={cn("pl-9", className)} {...props} />
      <Icon
        className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5 pointer-events-none"
        aria-hidden="true"
      />
    </div>
  );
}

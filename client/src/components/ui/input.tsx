import * as React from "react"

import { cn } from "@/lib/utils"
import { useIMEComposition } from "@/components/ui/ime-composition"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, value, onChange, onCompositionStart, onCompositionEnd, ...props }, ref) => {
    // h-9 to match icon buttons and default buttons.
    // IME(한글) 보호는 분리창 안에서만 적용된다(useIMEComposition 내부 판별). 메인 창은 native 통과.
    const ime = useIMEComposition<HTMLInputElement>({
      value,
      onChange,
      onCompositionStart,
      onCompositionEnd,
    })
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        value={ime.value}
        onChange={ime.onChange}
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }

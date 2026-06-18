import * as React from "react"

import { cn } from "@/lib/utils"
import { useIMEComposition } from "@/components/ui/ime-composition"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, value, onChange, onCompositionStart, onCompositionEnd, ...props }, ref) => {
  // IME(한글) 보호는 분리창 안에서만 적용된다(useIMEComposition 내부 판별). 메인 창은 native 통과.
  const ime = useIMEComposition<HTMLTextAreaElement>({
    value,
    onChange,
    onCompositionStart,
    onCompositionEnd,
  })
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
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
})
Textarea.displayName = "Textarea"

export { Textarea }

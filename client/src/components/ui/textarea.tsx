import * as React from "react"

import { cn } from "@/lib/utils"
import { useIsDetachedWindow } from "@/components/detached-window"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, onChange, onCompositionStart, onCompositionEnd, ...props }, ref) => {
  // IME(한글/일본어/중국어) 조합 보호: 분리창(window.open)처럼 별도 React root에서는
  // 조합 중 onChange가 value를 되돌려 글자가 중복/깨져 입력된다. 분리창 안에서만 조합 중
  // onChange를 억제하고 compositionend에서 1회 확정한다. 메인 창은 React가 조합 중 value
  // 덮어쓰기를 자체 처리하므로 가드를 적용하면 오히려 리렌더로 입력이 지워질 수 있어 native로 통과.
  const detached = useIsDetachedWindow()
  const isComposingRef = React.useRef(false)
  const cls = cn(
    "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
    className
  )
  if (!detached) {
    return (
      <textarea
        className={cls}
        ref={ref}
        onChange={onChange}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        {...props}
      />
    )
  }
  return (
    <textarea
      className={cls}
      ref={ref}
      onChange={(e) => {
        if (isComposingRef.current) return
        onChange?.(e)
      }}
      onCompositionStart={(e) => {
        isComposingRef.current = true
        onCompositionStart?.(e)
      }}
      onCompositionEnd={(e) => {
        isComposingRef.current = false
        onChange?.(e as unknown as React.ChangeEvent<HTMLTextAreaElement>)
        onCompositionEnd?.(e)
      }}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }

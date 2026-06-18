import * as React from "react"
import { useIMEComposition } from "@/components/ui/ime-composition"

// native <input>/<textarea>에 분리창 IME(한글) 보호만 추가한 1:1 패스스루.
// 스타일/className/모든 props 그대로 전달 → 시각/동작 동일, 분리창 안에서만 IME 보정.
// (보정 로직과 "분리창 한정" 판별은 useIMEComposition에 집중. 메인 창은 native 통과.)

const IMEInput = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ value, onChange, onCompositionStart, onCompositionEnd, ...props }, ref) => {
    const ime = useIMEComposition<HTMLInputElement>({
      value,
      onChange,
      onCompositionStart,
      onCompositionEnd,
    })
    return (
      <input
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
IMEInput.displayName = "IMEInput"

const IMETextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ value, onChange, onCompositionStart, onCompositionEnd, ...props }, ref) => {
  const ime = useIMEComposition<HTMLTextAreaElement>({
    value,
    onChange,
    onCompositionStart,
    onCompositionEnd,
  })
  return (
    <textarea
      ref={ref}
      value={ime.value}
      onChange={ime.onChange}
      onCompositionStart={ime.onCompositionStart}
      onCompositionEnd={ime.onCompositionEnd}
      {...props}
    />
  )
})
IMETextarea.displayName = "IMETextarea"

export { IMEInput, IMETextarea }

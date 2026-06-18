import * as React from "react"

import { Input } from "@/components/ui/input"

// 숫자 전용 입력 필드.
// - 표시는 천단위 콤마(toLocaleString), 0/빈값은 placeholder만 노출.
// - 한글/문자 입력 차단: onBeforeInput에서 숫자 아닌 직접 입력은 막고, 그래도 들어온
//   값(한글 IME 조합 commit, 붙여넣기 등)은 onChange에서 숫자만 남겨 정수로 환산.
// - disableIME: 숫자 필드는 한글 조합 미러가 필요 없으므로 IME 가드를 끈다(분리창 포함).
export interface NumericInputProps
  extends Omit<
    React.ComponentProps<typeof Input>,
    "value" | "onChange" | "type" | "inputMode" | "disableIME"
  > {
  value: number
  onValueChange: (value: number) => void
}

const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  ({ value, onValueChange, ...props }, ref) => {
    return (
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="numeric"
        disableIME
        value={value ? value.toLocaleString() : ""}
        onBeforeInput={(e) => {
          const data = (e.nativeEvent as InputEvent).data
          if (data != null && /[^0-9]/.test(data)) {
            e.preventDefault()
          }
        }}
        onChange={(e) => {
          const cleaned = e.target.value.replace(/[^0-9]/g, "")
          onValueChange(cleaned ? parseInt(cleaned, 10) : 0)
        }}
      />
    )
  }
)
NumericInput.displayName = "NumericInput"

export { NumericInput }

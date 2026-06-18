import * as React from "react"

// 분리창(window.open)처럼 별도 React root에서는 controlled native input/textarea가
// IME(한글/일본어/중국어) 조합 중 onChange로 value를 되돌려 글자가 중복/깨져 입력된다.
// 이 컴포넌트는 native <input>/<textarea>에 composition 가드만 추가한 1:1 패스스루다.
// (스타일/className/모든 props 그대로 전달 → 시각/동작 동일, IME만 보호. ASCII는 영향 없음.)

const IMEInput = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ onChange, onCompositionStart, onCompositionEnd, ...props }, ref) => {
    const isComposingRef = React.useRef(false)
    return (
      <input
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
          onChange?.(e as unknown as React.ChangeEvent<HTMLInputElement>)
          onCompositionEnd?.(e)
        }}
        {...props}
      />
    )
  }
)
IMEInput.displayName = "IMEInput"

const IMETextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ onChange, onCompositionStart, onCompositionEnd, ...props }, ref) => {
  const isComposingRef = React.useRef(false)
  return (
    <textarea
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
IMETextarea.displayName = "IMETextarea"

export { IMEInput, IMETextarea }

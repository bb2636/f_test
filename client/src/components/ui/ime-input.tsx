import * as React from "react"
import { useIsDetachedWindow } from "@/components/detached-window"

// 분리창(window.open)처럼 별도 React root에서는 controlled native input/textarea가
// IME(한글/일본어/중국어) 조합 중 onChange로 value를 되돌려 글자가 중복/깨져 입력된다.
// 이 컴포넌트는 native <input>/<textarea>에 composition 가드만 추가한 1:1 패스스루다.
// (스타일/className/모든 props 그대로 전달 → 시각/동작 동일, IME만 보호. ASCII는 영향 없음.)
//
// **중요:** 가드는 "분리창 안"에서만 적용한다. 메인 창에서는 React가 조합 중 controlled value
// 덮어쓰기를 자체적으로 막아 가드가 불필요할 뿐 아니라, 조합 중 onChange를 억제하면 무거운
// 페이지의 백그라운드 리렌더가 stale value로 입력을 지워 "입력이 안 되는" 회귀가 생긴다.
// 따라서 메인 창에서는 plain native(원래 동작)로 통과시킨다.

const IMEInput = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ onChange, onCompositionStart, onCompositionEnd, ...props }, ref) => {
    const detached = useIsDetachedWindow()
    const isComposingRef = React.useRef(false)

    if (!detached) {
      return (
        <input
          ref={ref}
          onChange={onChange}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          {...props}
        />
      )
    }

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
  const detached = useIsDetachedWindow()
  const isComposingRef = React.useRef(false)

  if (!detached) {
    return (
      <textarea
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

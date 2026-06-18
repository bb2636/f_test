import * as React from "react"
import { useIsDetachedWindow } from "@/components/detached-window"

// 분리창(window.open)은 별도 document라 React의 SyntheticEvent/composition 추적이
// 메인 document 기준으로만 동작 → controlled input/textarea가 IME(한글) 조합을 제대로
// 처리하지 못해 글자가 깨지거나(중복) 입력이 안 된다. 이를 보정하는 공용 훅.
//
// 핵심: 단순히 "조합 중 onChange 억제"만으로는 부족하다. 조합 도중 부모가 리렌더되면
// React가 controlled `value`를 stale 값으로 되돌려 진행 중인 조합을 지워버리기 때문이다
// (예: 인보이스 팝업 메모처럼 배열/useMemo 재계산으로 리렌더가 잦은 곳).
// 따라서 분리창 안에서는 **로컬 미러 상태(inner)** 로 표시값을 보유하고, 조합 중에는
// 외부 value 동기화를 차단해 리렌더에도 입력이 살아남게 한다.
//
// 메인 창에서는 React가 조합 중 value 덮어쓰기를 자체 처리하므로 가드가 불필요할 뿐
// 아니라 오히려 회귀를 유발한다 → 그대로(native) 통과시킨다.

type CompositionProps<E extends HTMLInputElement | HTMLTextAreaElement> = {
  value?: string | number | readonly string[]
  onChange?: React.ChangeEventHandler<E>
  onCompositionStart?: React.CompositionEventHandler<E>
  onCompositionEnd?: React.CompositionEventHandler<E>
}

export function useIMEComposition<
  E extends HTMLInputElement | HTMLTextAreaElement
>({
  value,
  onChange,
  onCompositionStart,
  onCompositionEnd,
}: CompositionProps<E>): CompositionProps<E> {
  const detached = useIsDetachedWindow()
  const isComposingRef = React.useRef(false)
  const controlled = value !== undefined
  const [inner, setInner] = React.useState<string>(
    controlled ? String(value ?? "") : ""
  )

  // 조합 중이 아닐 때만 외부 value를 로컬 미러로 동기화(분리창 한정).
  React.useEffect(() => {
    if (detached && controlled && !isComposingRef.current) {
      setInner(String(value ?? ""))
    }
  }, [value, detached, controlled])

  if (!detached) {
    // 메인 창: 원래 동작 그대로.
    return { value, onChange, onCompositionStart, onCompositionEnd }
  }

  return {
    value: controlled ? inner : value,
    onChange: (e: React.ChangeEvent<E>) => {
      if (controlled) setInner(e.target.value)
      if (!isComposingRef.current) onChange?.(e)
    },
    onCompositionStart: (e: React.CompositionEvent<E>) => {
      isComposingRef.current = true
      onCompositionStart?.(e)
    },
    onCompositionEnd: (e: React.CompositionEvent<E>) => {
      isComposingRef.current = false
      const v = (e.currentTarget as E).value
      if (controlled) setInner(v)
      onChange?.(e as unknown as React.ChangeEvent<E>)
      onCompositionEnd?.(e)
    },
  }
}

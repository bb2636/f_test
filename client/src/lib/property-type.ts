export type PropertyType =
  | "아파트"
  | "연립주택"
  | "상가"
  | "공장"
  | "시설물"
  | "단독주택"
  | "기타";

export function classifyPropertyType(
  addressDetail?: string | null,
  address?: string | null,
): PropertyType {
  const text = [address, addressDetail].filter(Boolean).join(" ").trim();
  if (!text) return "기타";

  if (/공장|산업단지|공단|제조/.test(text)) return "공장";

  if (
    /상가|프라자|플라자/.test(text) ||
    /[가-힣A-Za-z0-9]+몰(?:\s|$|[)\],.])/.test(text + " ")
  ) {
    return "상가";
  }

  // 아파트를 단일동(가동/A동) 패턴보다 먼저 판정해 "아파트 A동" 같은 케이스 보호
  if (/아파트/.test(text)) return "아파트";

  if (/빌라|연립|타운하우스|테라스하우스|테리스하우스/.test(text)) {
    return "연립주택";
  }
  if (/(?:^|\s)[가나다라마바사아자차카타파하]동(?:\s|$|[)\],.])/.test(" " + text + " ")) {
    return "연립주택";
  }
  if (/(?:^|\s)[A-Za-z]동(?:\s|$|[)\],.])/.test(" " + text + " ")) {
    return "연립주택";
  }

  if (/\d+\s*-\s*\d+/.test(text)) return "아파트";
  if (/\d+동/.test(text)) return "아파트";

  if (/[가-힣A-Za-z0-9]+(?:소|창고|장)(?:\s|$|[)\],.])/.test(text + " ")) {
    return "시설물";
  }

  // 단독주택 판정:
  // (1) "단독/다가구/다세대" 키워드가 있으면 단독주택
  if (/단독|다가구|다세대/.test(text)) return "단독주택";
  // (2) 도로명주소(○○로/○○길) + 번지(숫자) 형태로만 구성된 경우 단독주택
  if (/[가-힣A-Za-z0-9]+(?:로|길)\s*\d+/.test(text)) return "단독주택";

  return "기타";
}

export function extractCancelReason(
  specialNotes?: string | null,
): string {
  if (!specialNotes) return "-";
  const marker = "[취소사유]";
  const idx = specialNotes.indexOf(marker);
  if (idx === -1) return "-";
  let rest = specialNotes.slice(idx + marker.length);
  // 후속 섹션 마커(\n[...] 또는 공백 후 [...]) 전까지만 추출
  const nextMarker = rest.search(/(?:\r?\n|\s)\[[^\]]+\]/);
  if (nextMarker !== -1) rest = rest.slice(0, nextMarker);
  rest = rest.trim();
  if (!rest) return "-";
  return rest.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

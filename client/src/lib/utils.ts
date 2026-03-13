import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCaseNumber(caseNumber: string | null | undefined): string {
  if (!caseNumber) return "";
  
  // 손방건의 경우 -0 접미사 유지
  // 251124001-0 -> 251124001-0 (그대로 유지)
  // 251124001-1 -> 251124001-1 (그대로 유지)
  return caseNumber;
}

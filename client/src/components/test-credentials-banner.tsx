import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function TestCredentialsBanner() {
  return (
    <Alert className="border-blue-200 bg-blue-50">
      <Info className="h-4 w-4 text-blue-600" />
      <AlertDescription className="text-sm text-gray-700 ml-2">
        <strong className="font-semibold">테스트 계정:</strong> 아이디{" "}
        <code className="px-2 py-0.5 rounded bg-white border border-gray-200 text-xs font-mono text-gray-800">xblock01</code>{" "}
        / 비밀번호{" "}
        <code className="px-2 py-0.5 rounded bg-white border border-gray-200 text-xs font-mono text-gray-800">1234</code>
      </AlertDescription>
    </Alert>
  );
}

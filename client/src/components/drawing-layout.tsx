import { GlobalHeader } from "./global-header";

interface DrawingLayoutProps {
  children: React.ReactNode;
}

export function DrawingLayout({ children }: DrawingLayoutProps) {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <GlobalHeader />
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

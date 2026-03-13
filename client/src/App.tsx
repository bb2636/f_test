import { Suspense, lazy } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FloatingIntakeButton } from "@/components/floating-intake-button";
import { ProtectedRoute } from "@/components/protected-route";
import { Loader2 } from "lucide-react";

const Login = lazy(() => import("@/pages/login"));
const MobileLogin = lazy(() => import("@/pages/mobile-login"));
const MobileHome = lazy(() => import("@/pages/mobile-home"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const AdminSettings = lazy(() => import("@/pages/admin-settings"));
const Intake = lazy(() => import("@/pages/intake"));
const ComprehensiveProgress = lazy(() => import("@/pages/comprehensive-progress"));
const StatisticsOverview = lazy(() => import("@/pages/statistics-overview"));
const ClosedCaseStatistics = lazy(() => import("@/pages/closed-case-statistics"));
const UnsettledCaseStatistics = lazy(() => import("@/pages/unsettled-case-statistics"));
const SettlementsInquiry = lazy(() => import("@/pages/settlements-inquiry"));
const SettlementAction = lazy(() => import("@/pages/settlement-action"));
const FieldManagement = lazy(() => import("@/pages/field-management"));
const FieldDrawing = lazy(() => import("@/pages/field-drawing"));
const FieldDocuments = lazy(() => import("@/pages/field-documents"));
const FieldEstimate = lazy(() => import("@/pages/field-estimate"));
const FieldReport = lazy(() => import("@/pages/field-report"));
const Forbidden = lazy(() => import("@/pages/forbidden"));
const NotFound = lazy(() => import("@/pages/not-found"));

const StatisticsLayout = lazy(() => import("@/components/statistics-layout").then(m => ({ default: m.StatisticsLayout })));
const FieldSurveyLayout = lazy(() => import("@/components/field-survey-layout").then(m => ({ default: m.FieldSurveyLayout })));
const DrawingLayout = lazy(() => import("@/components/drawing-layout").then(m => ({ default: m.DrawingLayout })));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-screen w-full" data-testid="page-loader">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={Login} />
        <Route path="/login" component={Login} />
        <Route path="/mobile-login" component={MobileLogin} />
        <Route path="/mobile-home" component={MobileHome} />
        <Route path="/forbidden" component={Forbidden} />
        
        <Route path="/home">
          {() => (
            <ProtectedRoute category="홈">
              <Dashboard />
            </ProtectedRoute>
          )}
        </Route>
        <Route path="/dashboard">
          {() => (
            <ProtectedRoute category="홈">
              <Dashboard />
            </ProtectedRoute>
          )}
        </Route>
        
        <Route path="/admin-settings">
          {() => (
            <ProtectedRoute category="관리자 설정">
              <AdminSettings />
            </ProtectedRoute>
          )}
        </Route>
        
        <Route path="/intake">
          {() => (
            <ProtectedRoute category="새로운접수">
              <Intake />
            </ProtectedRoute>
          )}
        </Route>
        
        <Route path="/comprehensive-progress">
          {() => (
            <ProtectedRoute category="종합진행관리">
              <ComprehensiveProgress />
            </ProtectedRoute>
          )}
        </Route>
        
        <Route path="/statistics">
          {() => (
            <ProtectedRoute category="정산 및 통계" item="통계">
              <StatisticsLayout>
                <ClosedCaseStatistics />
              </StatisticsLayout>
            </ProtectedRoute>
          )}
        </Route>
        

        <Route path="/statistics/closed">
          {() => (
            <ProtectedRoute category="정산 및 통계" item="통계">
              <StatisticsLayout>
                <ClosedCaseStatistics />
              </StatisticsLayout>
            </ProtectedRoute>
          )}
        </Route>

        <Route path="/statistics/unsettled">
          {() => (
            <ProtectedRoute category="정산 및 통계" item="통계">
              <StatisticsLayout>
                <UnsettledCaseStatistics />
              </StatisticsLayout>
            </ProtectedRoute>
          )}
        </Route>
        
        <Route path="/settlements">
          {() => (
            <ProtectedRoute category="정산 및 통계" item="정산조회">
              <StatisticsLayout>
                <SettlementsInquiry filterMode="claim" />
              </StatisticsLayout>
            </ProtectedRoute>
          )}
        </Route>

        <Route path="/settlements/claim">
          {() => (
            <ProtectedRoute category="정산 및 통계" item="정산조회">
              <StatisticsLayout>
                <SettlementsInquiry filterMode="claim" />
              </StatisticsLayout>
            </ProtectedRoute>
          )}
        </Route>

        <Route path="/settlements/closed">
          {() => (
            <ProtectedRoute category="정산 및 통계" item="정산조회">
              <StatisticsLayout>
                <SettlementsInquiry filterMode="closed" />
              </StatisticsLayout>
            </ProtectedRoute>
          )}
        </Route>
        
        <Route path="/statistics/settlements-inquiry">
          {() => (
            <ProtectedRoute category="정산 및 통계" item="정산조회">
              <StatisticsLayout>
                <SettlementsInquiry filterMode="claim" />
              </StatisticsLayout>
            </ProtectedRoute>
          )}
        </Route>
        
        <Route path="/statistics/settlement-action">
          {() => (
            <ProtectedRoute category="정산 및 통계" item="정산조회">
              <StatisticsLayout>
                <SettlementAction />
              </StatisticsLayout>
            </ProtectedRoute>
          )}
        </Route>
        
        <Route path="/field-survey/management">
          {() => (
            <ProtectedRoute category="현장조사" item="현장입력">
              <FieldSurveyLayout>
                <FieldManagement />
              </FieldSurveyLayout>
            </ProtectedRoute>
          )}
        </Route>
        
        <Route path="/field-survey/drawing">
          {() => (
            <ProtectedRoute category="현장조사" item="도면작성">
              <DrawingLayout>
                <FieldDrawing />
              </DrawingLayout>
            </ProtectedRoute>
          )}
        </Route>
        
        <Route path="/field-survey/documents">
          {() => (
            <ProtectedRoute category="현장조사" item="증빙자료 업로드">
              <FieldSurveyLayout>
                <FieldDocuments />
              </FieldSurveyLayout>
            </ProtectedRoute>
          )}
        </Route>
        
        <Route path="/field-survey/estimate">
          {() => (
            <ProtectedRoute category="현장조사" item="견적서 작성">
              <FieldEstimate />
            </ProtectedRoute>
          )}
        </Route>
        
        <Route path="/field-survey/report">
          {() => (
            <ProtectedRoute category="현장조사" item="보고서 작성">
              <FieldSurveyLayout>
                <FieldReport />
              </FieldSurveyLayout>
            </ProtectedRoute>
          )}
        </Route>
        
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
        <FloatingIntakeButton />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

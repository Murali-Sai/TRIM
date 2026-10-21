import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Routes } from 'react-router';
import { AppShell } from './components/AppShell';
import { AccountPage } from './pages/AccountPage';
import { BadgesPage } from './pages/BadgesPage';
import { ExportPage } from './pages/export/ExportPage';
import { PhasesPage } from './pages/phases/PhasesPage';
import { StaplesPage } from './pages/StaplesPage';
import { MetricsPage } from './pages/body/MetricsPage';
import { MeasurementsPage } from './pages/measure/MeasurementsPage';
import { BodyPage } from './pages/BodyPage';
import { CalculatorPage } from './pages/CalculatorPage';
import { ForgotPage } from './pages/ForgotPage';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { LogPage } from './pages/LogPage';
import { ResetPage } from './pages/ResetPage';
import { SetupPage } from './pages/setup/SetupPage';
import { SignupPage } from './pages/SignupPage';
import { TargetsPage } from './pages/TargetsPage';
import { TodayPage } from './pages/TodayPage';
import { VerifyPage } from './pages/VerifyPage';
import { ProgressPage } from './pages/progress/ProgressPage';

// The charts load uPlot, so they come in their own chunk.
const CaloriesPage = lazy(() =>
  import('./pages/charts/CaloriesPage').then((m) => ({ default: m.CaloriesPage })),
);
const MacrosPage = lazy(() =>
  import('./pages/charts/MacrosPage').then((m) => ({ default: m.MacrosPage })),
);

function Loading({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="min-h-56" aria-busy="true" />}>{children}</Suspense>;
}

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<TodayPage />} />
        <Route path="log" element={<LogPage />} />
        <Route path="body" element={<BodyPage />} />
        <Route path="body/metrics" element={<MetricsPage />} />
        <Route path="charts" element={<ProgressPage />} />
        <Route
          path="charts/calories"
          element={
            <Loading>
              <CaloriesPage />
            </Loading>
          }
        />
        <Route
          path="charts/macros"
          element={
            <Loading>
              <MacrosPage />
            </Loading>
          }
        />
        <Route path="charts/measurements" element={<MeasurementsPage />} />
        <Route path="targets" element={<TargetsPage />} />
        <Route path="targets/calculator" element={<CalculatorPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="account/badges" element={<BadgesPage />} />
        <Route path="account/export" element={<ExportPage />} />
        <Route path="staples" element={<StaplesPage />} />
        <Route path="phases" element={<PhasesPage />} />
      </Route>
      <Route path="setup" element={<SetupPage />} />
      <Route path="welcome" element={<LandingPage />} />
      <Route path="signup" element={<SignupPage />} />
      <Route path="verify" element={<VerifyPage />} />
      <Route path="login" element={<LoginPage />} />
      <Route path="forgot" element={<ForgotPage />} />
      <Route path="reset" element={<ResetPage />} />
    </Routes>
  );
}

import { Route, Routes } from 'react-router';
import { AppShell } from './components/AppShell';
import { AccountPage } from './pages/AccountPage';
import { BodyPage } from './pages/BodyPage';
import { ForgotPage } from './pages/ForgotPage';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { Placeholder } from './pages/Placeholder';
import { ResetPage } from './pages/ResetPage';
import { SetupPage } from './pages/setup/SetupPage';
import { SignupPage } from './pages/SignupPage';
import { VerifyPage } from './pages/VerifyPage';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Placeholder title="Today" note="Your day will show here." />} />
        <Route
          path="log"
          element={<Placeholder title="Log food" note="Food search comes next." />}
        />
        <Route path="body" element={<BodyPage />} />
        <Route
          path="charts"
          element={<Placeholder title="Progress" note="Your charts will show here." />}
        />
        <Route path="account" element={<AccountPage />} />
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

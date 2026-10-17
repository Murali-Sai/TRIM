import { Route, Routes } from 'react-router';
import { AppShell } from './components/AppShell';
import { AccountPage } from './pages/AccountPage';
import { AuthPlaceholder } from './pages/AuthPlaceholder';
import { LandingPage } from './pages/LandingPage';
import { Placeholder } from './pages/Placeholder';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Placeholder title="Today" note="Your day will show here." />} />
        <Route
          path="log"
          element={<Placeholder title="Log food" note="Food search comes next." />}
        />
        <Route
          path="body"
          element={<Placeholder title="Body" note="Weight and measurements will show here." />}
        />
        <Route
          path="charts"
          element={<Placeholder title="Progress" note="Your charts will show here." />}
        />
        <Route path="account" element={<AccountPage />} />
      </Route>
      <Route path="welcome" element={<LandingPage />} />
      <Route path="signup" element={<AuthPlaceholder title="Sign up" />} />
      <Route path="login" element={<AuthPlaceholder title="Log in" />} />
    </Routes>
  );
}

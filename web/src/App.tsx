import { Route, Routes } from 'react-router';
import { AppShell } from './components/AppShell';
import { AccountPage } from './pages/AccountPage';
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
    </Routes>
  );
}

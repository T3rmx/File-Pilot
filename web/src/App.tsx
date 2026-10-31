import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";

import { AuthProvider, useAuth } from "./lib/auth";
import { I18nProvider } from "./lib/i18n";
import { ThemeProvider } from "./lib/theme";
import { UIProvider } from "./lib/ui";
import { Layout } from "./components/Layout";
import { Logo } from "./components/Icons";
import { DashboardPage } from "./pages/Dashboard";
import { FilesPage } from "./pages/Files";
import { LoginPage } from "./pages/Login";
import { NotFoundPage } from "./pages/NotFound";
import { PublicSharePage } from "./pages/PublicShare";
import { SettingsPage } from "./pages/Settings";
import { SetupPage } from "./pages/Setup";
import { SharesPage } from "./pages/Shares";
import { TransfersPage } from "./pages/Transfers";

function BootScreen() {
  return (
    <div className="boot-screen">
      <Logo size={48} />
      <span className="spinner" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { status, configured, user } = useAuth();
  const location = useLocation();

  if (status === "loading") return <BootScreen />;
  if (!configured) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <UIProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/setup" element={<SetupPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/s/:token" element={<PublicSharePage />} />
                <Route
                  element={
                    <RequireAuth>
                      <Layout />
                    </RequireAuth>
                  }
                >
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/files" element={<FilesPage />} />
                  <Route path="/shares" element={<SharesPage />} />
                  <Route path="/transfers" element={<TransfersPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </BrowserRouter>
          </UIProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

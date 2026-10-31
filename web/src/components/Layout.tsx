import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../lib/auth";
import { initials } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useTheme } from "../lib/theme";
import { cx, isLocalUpload, useUI } from "../lib/ui";
import { wsTicket } from "../lib/api";
import { Icon, Logo } from "./Icons";
import type { IconName } from "./Icons";

const NAV: { to: string; key: string; icon: IconName; end?: boolean }[] = [
  { to: "/", key: "nav.dashboard", icon: "dashboard", end: true },
  { to: "/files", key: "nav.files", icon: "folder" },
  { to: "/shares", key: "nav.shares", icon: "link" },
];

const SYSTEM_NAV: { to: string; key: string; icon: IconName }[] = [
  { to: "/transfers", key: "nav.transfers", icon: "transfer" },
  { to: "/settings", key: "nav.settings", icon: "settings" },
];

const TITLES: Record<string, string> = {
  "/": "nav.dashboard",
  "/files": "nav.files",
  "/shares": "nav.shares",
  "/transfers": "nav.transfers",
  "/settings": "nav.settings",
};

export function Layout() {
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const { toast } = useUI();
  const location = useLocation();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  useEffect(() => {
    if (!user) return;
    let socket: WebSocket | null = null;
    let closed = false;
    let timer = 0;
    let attempts = 0;

    const connect = async () => {
      try {
        const ticket = await wsTicket();
        if (closed) return;
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(`${protocol}//${window.location.host}/ws?ticket=${encodeURIComponent(ticket)}`);
        socket.onopen = () => {
          attempts = 0;
        };
        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as { type?: string; name?: string };
            if (data.type === "file.uploaded" && data.name && !isLocalUpload(data.name)) {
              toast(t("toast.uploaded", { name: data.name }), "success");
              window.dispatchEvent(new CustomEvent("fp:files-changed"));
            }
          } catch {
            /* ignore malformed frames */
          }
        };
        socket.onclose = () => {
          if (closed) return;
          attempts += 1;
          timer = window.setTimeout(connect, Math.min(30000, 1500 * attempts));
        };
      } catch {
        if (closed) return;
        attempts += 1;
        timer = window.setTimeout(connect, Math.min(30000, 1500 * attempts));
      }
    };

    void connect();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      socket?.close();
    };
  }, [user, toast, t]);

  const titleKey = TITLES[location.pathname] ?? "app.tagline";
  const otherLang = lang === "en" ? "ar" : "en";

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      {drawerOpen && (
        <button
          type="button"
          className="drawer-backdrop"
          aria-label={t("common.close")}
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <aside className={cx("sidebar", drawerOpen && "is-open")}>
        <div className="sidebar-brand">
          <Logo size={38} />
          <div className="brand-copy">
            <span className="brand-name">FilePilot</span>
            <span className="brand-tagline">{t("app.tagline")}</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Main">
          <p className="nav-label">{t("nav.section.workspace")}</p>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => cx("nav-item", isActive && "is-active")}
            >
              <Icon name={item.icon} size={19} />
              <span>{t(item.key)}</span>
            </NavLink>
          ))}

          <p className="nav-label">{t("nav.section.system")}</p>
          {SYSTEM_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => cx("nav-item", isActive && "is-active")}
            >
              <Icon name={item.icon} size={19} />
              <span>{t(item.key)}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        <div className="sidebar-badge">
          <Icon name="shield" size={15} />
          <span>{t("app.secure")}</span>
          <span className="status-dot" />
        </div>

        {user && (
          <div className="sidebar-user">
            <div className="user-row">
              <span className="avatar">{initials(user.display_name || user.username)}</span>
              <div className="user-copy">
                <span className="user-name">{user.display_name || user.username}</span>
                <span className="user-role">{user.role === "admin" ? t("auth.admin") : t("auth.user")}</span>
              </div>
            </div>
            <div className="user-tools">
              <button
                type="button"
                className="icon-btn"
                onClick={toggle}
                title={t("settings.theme")}
                aria-label={t("settings.theme")}
              >
                <Icon name={theme === "dark" ? "sun" : "moon"} size={17} />
              </button>
              <button
                type="button"
                className="icon-btn lang-btn"
                onClick={() => setLang(otherLang)}
                title={t("settings.language")}
                aria-label={t("settings.language")}
              >
                <Icon name="globe" size={16} />
                <span>{lang === "en" ? "ع" : "EN"}</span>
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => void handleLogout()}
                title={t("auth.signOut")}
                aria-label={t("auth.signOut")}
              >
                <Icon name="logout" size={17} />
              </button>
            </div>
          </div>
        )}
      </aside>

      <div className="app-body">
        <header className="mobile-bar">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setDrawerOpen(true)}
            aria-label={t("common.open")}
            aria-expanded={drawerOpen}
          >
            <Icon name="menu" size={20} />
          </button>
          <div className="mobile-brand">
            <Logo size={28} />
            <span>{t(titleKey)}</span>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={toggle}
            aria-label={t("settings.theme")}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
          </button>
        </header>

        <main id="main" className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

import type { ReactNode } from "react";

import { useI18n } from "../lib/i18n";
import { useTheme } from "../lib/theme";
import { Icon, Logo } from "./Icons";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();

  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div className="auth-brand">
          <Logo size={40} />
          <div>
            <span className="brand-name">FilePilot</span>
            <span className="brand-tagline">{t("app.tagline")}</span>
          </div>
        </div>

        <div className="auth-aside-body">
          <h1>{t("auth.brandLine")}</h1>
          <ul className="auth-points">
            <li>
              <span className="auth-point-icon">
                <Icon name="shield" size={18} />
              </span>
              <span>{t("auth.step2")}</span>
            </li>
            <li>
              <span className="auth-point-icon">
                <Icon name="wifi" size={18} />
              </span>
              <span>{t("auth.step1")}</span>
            </li>
            <li>
              <span className="auth-point-icon">
                <Icon name="link" size={18} />
              </span>
              <span>{t("auth.step3")}</span>
            </li>
          </ul>
        </div>

        <div className="auth-aside-foot">
          <span className="status-dot" />
          <span>6969</span>
          <span className="auth-foot-sep">·</span>
          <span>{t("app.secure")}</span>
        </div>
      </aside>

      <div className="auth-main">
        <div className="auth-tools">
          <button
            type="button"
            className="icon-btn"
            onClick={toggle}
            aria-label={t("settings.theme")}
            title={t("settings.theme")}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
          </button>
          <button
            type="button"
            className="icon-btn lang-btn"
            onClick={() => setLang(lang === "en" ? "ar" : "en")}
            aria-label={t("settings.language")}
            title={t("settings.language")}
          >
            <Icon name="globe" size={16} />
            <span>{lang === "en" ? "ع" : "EN"}</span>
          </button>
        </div>

        <div className="auth-card">
          <div className="auth-mobile-brand">
            <Logo size={34} />
            <span className="brand-name">FilePilot</span>
          </div>
          <h2>{title}</h2>
          <p className="auth-subtitle">{subtitle}</p>
          {children}
          {footer && <div className="auth-footer">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

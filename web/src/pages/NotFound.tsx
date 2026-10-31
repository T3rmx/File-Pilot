import { Link } from "react-router-dom";

import { useI18n } from "../lib/i18n";
import { Icon, Logo } from "../components/Icons";

export function NotFoundPage() {
  const { t } = useI18n();

  return (
    <div className="notfound-page">
      <div className="notfound-card">
        <Logo size={44} />
        <span className="notfound-code">404</span>
        <h1>{t("notfound.title")}</h1>
        <p>{t("notfound.body")}</p>
        <Link className="btn btn-primary" to="/">
          <Icon name="home" size={16} />
          <span>{t("notfound.home")}</span>
        </Link>
      </div>
    </div>
  );
}

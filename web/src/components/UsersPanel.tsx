import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import { ApiError, api } from "../lib/api";
import type { ManagedUser, Role, UserCreateInput, UserUpdateInput } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatBytes } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { cx, Field, Modal, Spinner, useUI } from "../lib/ui";
import { Icon } from "../components/Icons";

const ROLES: Role[] = ["admin", "user", "viewer"];

function initials(user: ManagedUser): string {
  const source = user.display_name || user.username;
  return source.slice(0, 2).toUpperCase();
}

function quotaMb(user: ManagedUser | null): string {
  return user?.quota_bytes ? String(Math.round(user.quota_bytes / (1024 * 1024))) : "";
}

export function UsersPanel() {
  const { t, lang } = useI18n();
  const { user: me } = useAuth();
  const { toast } = useUI();

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all");

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ManagedUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const [newUsername, setNewUsername] = useState("");
  const [newDisplay, setNewDisplay] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("user");
  const [newQuota, setNewQuota] = useState("");

  const [editDisplay, setEditDisplay] = useState("");
  const [editRole, setEditRole] = useState<Role>("user");
  const [editQuota, setEditQuota] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editDisabled, setEditDisabled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ items: ManagedUser[] }>("/api/users");
      setUsers(data.items);
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : t("users.loadFailed"), "error");
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const roleLabel = (role: Role | string) => t(`users.role.${role}`);
  const self = (user: ManagedUser) => me?.id === user.id;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== "all" && user.role !== roleFilter) return false;
      if (!needle) return true;
      return (
        user.username.toLowerCase().includes(needle) ||
        user.display_name.toLowerCase().includes(needle)
      );
    });
  }, [users, query, roleFilter]);

  const resetAdd = () => {
    setNewUsername("");
    setNewDisplay("");
    setNewPassword("");
    setNewRole("user");
    setNewQuota("");
    setFormError("");
  };

  const openAdd = () => {
    resetAdd();
    setAddOpen(true);
  };

  const openEdit = (user: ManagedUser) => {
    setEditTarget(user);
    setEditDisplay(user.display_name);
    setEditRole((user.role as Role) ?? "user");
    setEditQuota(quotaMb(user));
    setEditPassword("");
    setEditDisabled(user.disabled);
    setFormError("");
  };

  const parseQuota = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const size = Number(trimmed);
    if (!Number.isFinite(size) || size <= 0) return null;
    return Math.round(size * 1024 * 1024);
  };

  const createUser = async (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    if (!/^[A-Za-z0-9._-]{2,64}$/.test(newUsername.trim())) {
      setFormError(t("auth.usernameRule"));
      return;
    }
    if (newPassword.length < 8) {
      setFormError(t("auth.passwordHint"));
      return;
    }
    setBusy(true);
    try {
      const payload: UserCreateInput = {
        username: newUsername.trim(),
        password: newPassword,
        display_name: newDisplay.trim(),
        role: newRole,
        quota_bytes: parseQuota(newQuota),
      };
      await api.post<ManagedUser>("/api/users", payload);
      toast(t("users.created"), "success");
      setAddOpen(false);
      resetAdd();
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.detail : t("common.unknownError"));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editTarget) return;
    setFormError("");
    if (editPassword && editPassword.length < 8) {
      setFormError(t("auth.passwordHint"));
      return;
    }
    setBusy(true);
    try {
      const payload: UserUpdateInput = {
        display_name: editDisplay.trim(),
        quota_bytes: parseQuota(editQuota),
      };
      if (!self(editTarget)) {
        payload.role = editRole;
        payload.disabled = editDisabled;
        if (editPassword) payload.password = editPassword;
      }
      await api.patch<ManagedUser>(`/api/users/${editTarget.id}`, payload);
      toast(t("users.updated"), "success");
      setEditTarget(null);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.detail : t("common.unknownError"));
    } finally {
      setBusy(false);
    }
  };

  const deleteUser = async () => {
    if (!deleteTarget) return;
    if (deleteConfirm.trim() !== deleteTarget.username) {
      setFormError(t("users.deleteMismatch"));
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await api.del(`/api/users/${deleteTarget.id}`);
      toast(t("users.deleted"), "success");
      setDeleteTarget(null);
      setDeleteConfirm("");
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.detail : t("common.unknownError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{t("users.title")}</h2>
        <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>
          <Icon name="plus" size={15} />
          <span>{t("users.add")}</span>
        </button>
      </header>
      <div className="panel-body">
        <p className="panel-note">
          <Icon name="shield" size={15} />
          <span>{t("users.hint")}</span>
        </p>

        <div className="users-toolbar">
          <span className="search-box users-search">
            <Icon name="search" size={15} />
            <input
              value={query}
              placeholder={t("users.search")}
              aria-label={t("users.search")}
              onChange={(event) => setQuery(event.target.value)}
            />
          </span>
          <select
            className="input users-filter"
            value={roleFilter}
            aria-label={t("users.filterRole")}
            onChange={(event) => setRoleFilter(event.target.value as "all" | Role)}
          >
            <option value="all">{t("users.allRoles")}</option>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {roleLabel(role)}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <Spinner label={t("common.loading")} />
        ) : filtered.length === 0 ? (
          <p className="panel-note">
            <Icon name="user" size={15} />
            <span>{t("users.empty")}</span>
          </p>
        ) : (
          <div className="users-table">
            <div className="users-table-head" aria-hidden="true">
              <span>{t("users.user")}</span>
              <span>{t("users.roleLabel")}</span>
              <span>{t("users.storage")}</span>
              <span>{t("users.status")}</span>
              <span />
            </div>
            {filtered.map((user) => {
              const quota = user.quota_bytes;
              const percent = quota ? Math.min(100, Math.round((user.storage_used / quota) * 100)) : 0;
              return (
                <div key={user.id} className={cx("users-row", user.disabled && "is-disabled")}>
                  <div className="users-cell">
                    <span className="avatar">{initials(user)}</span>
                    <div className="users-name">
                      <strong>
                        {user.display_name || user.username}
                        {self(user) && <span className="chip chip-neutral">{t("users.you")}</span>}
                      </strong>
                      <span className="account-meta">@{user.username}</span>
                    </div>
                  </div>

                  <span className={cx("chip", `role-${user.role}`)}>{roleLabel(user.role)}</span>

                  <div className="users-usage">
                    <span>
                      {quota ? (
                        <>
                          {formatBytes(user.storage_used, lang)} / {formatBytes(quota, lang)}
                        </>
                      ) : (
                        <>
                          {formatBytes(user.storage_used, lang)} · {t("users.unlimited")}
                        </>
                      )}
                    </span>
                    <span className="users-file-count">
                      {t("users.files", { n: user.file_count })}
                    </span>
                    {quota ? (
                      <div className={cx("progress-track", percent >= 100 && "is-warn")}>
                        <div className="progress-fill" style={{ inlineSize: `${percent}%` }} />
                      </div>
                    ) : null}
                  </div>

                  <span className={cx("users-status", user.disabled ? "is-off" : "is-on")}>
                    <span className="status-dot" aria-hidden="true" />
                    {user.disabled ? t("users.disabled") : t("users.active")}
                  </span>

                  <div className="users-actions">
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm"
                      title={t("common.edit")}
                      aria-label={t("common.edit")}
                      onClick={() => openEdit(user)}
                    >
                      <Icon name="edit" size={15} />
                    </button>
                    {!self(user) && (
                      <button
                        type="button"
                        className="icon-btn icon-btn-sm icon-btn-danger"
                        title={t("common.delete")}
                        aria-label={t("common.delete")}
                        onClick={() => {
                          setDeleteTarget(user);
                          setDeleteConfirm("");
                          setFormError("");
                        }}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={t("users.addTitle")}
        subtitle={t("users.addSubtitle")}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setAddOpen(false)}>
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              form="add-user-form"
              className="btn btn-primary"
              disabled={busy}
            >
              {busy ? t("common.loading") : t("users.create")}
            </button>
          </>
        }
      >
        <form id="add-user-form" className="form-stack" onSubmit={(event) => void createUser(event)}>
          <div className="form-grid">
            <Field label={t("users.username")} htmlFor="new-username">
              <input
                id="new-username"
                className="input"
                value={newUsername}
                autoComplete="off"
                maxLength={64}
                onChange={(event) => setNewUsername(event.target.value)}
              />
            </Field>
            <Field label={t("users.displayName")} hint={t("common.optional")} htmlFor="new-display">
              <input
                id="new-display"
                className="input"
                value={newDisplay}
                maxLength={120}
                onChange={(event) => setNewDisplay(event.target.value)}
              />
            </Field>
          </div>
          <Field label={t("users.password")} hint={t("auth.passwordHint")} htmlFor="new-user-password">
            <input
              id="new-user-password"
              className="input"
              type="password"
              value={newPassword}
              autoComplete="new-password"
              maxLength={256}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Field>
          <div className="form-grid">
            <Field label={t("users.roleLabel")} htmlFor="new-role">
              <select
                id="new-role"
                className="input"
                value={newRole}
                onChange={(event) => setNewRole(event.target.value as Role)}
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)} — {t(`users.roleHint.${role}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("users.quota")} hint={t("users.quotaHint")} htmlFor="new-quota">
              <input
                id="new-quota"
                className="input"
                type="number"
                min={1}
                value={newQuota}
                placeholder={t("users.quotaPlaceholder")}
                onChange={(event) => setNewQuota(event.target.value)}
              />
            </Field>
          </div>
          {formError && (
            <p className="form-error" role="alert">
              <Icon name="alert" size={15} />
              <span>{formError}</span>
            </p>
          )}
        </form>
      </Modal>

      <Modal
        open={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        title={editTarget ? t("users.editTitle", { name: editTarget.username }) : ""}
        subtitle={t("users.editSubtitle")}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setEditTarget(null)}>
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              form="edit-user-form"
              className="btn btn-primary"
              disabled={busy}
            >
              {busy ? t("common.loading") : t("common.save")}
            </button>
          </>
        }
      >
        <form id="edit-user-form" className="form-stack" onSubmit={(event) => void saveEdit(event)}>
          <Field label={t("users.displayName")} htmlFor="edit-display">
            <input
              id="edit-display"
              className="input"
              value={editDisplay}
              maxLength={120}
              onChange={(event) => setEditDisplay(event.target.value)}
            />
          </Field>
          <div className="form-grid">
            <Field label={t("users.roleLabel")} htmlFor="edit-role">
              <select
                id="edit-role"
                className="input"
                value={editRole}
                disabled={Boolean(editTarget && self(editTarget))}
                onChange={(event) => setEditRole(event.target.value as Role)}
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("users.quota")} hint={t("users.quotaHint")} htmlFor="edit-quota">
              <input
                id="edit-quota"
                className="input"
                type="number"
                min={1}
                value={editQuota}
                placeholder={t("users.quotaPlaceholder")}
                onChange={(event) => setEditQuota(event.target.value)}
              />
            </Field>
          </div>

          {editTarget && !self(editTarget) && (
            <>
              <Field
                label={t("users.resetPassword")}
                hint={t("users.resetPasswordHint")}
                htmlFor="edit-password"
              >
                <input
                  id="edit-password"
                  className="input"
                  type="password"
                  value={editPassword}
                  autoComplete="new-password"
                  maxLength={256}
                  onChange={(event) => setEditPassword(event.target.value)}
                />
              </Field>
              <label className="toggle-row">
                <span className="toggle-copy">
                  <span className="toggle-label">{t("users.accountActive")}</span>
                  <span className="toggle-hint">{t("users.accountActiveHint")}</span>
                </span>
                <input
                  type="checkbox"
                  className="toggle-input"
                  checked={!editDisabled}
                  onChange={(event) => setEditDisabled(!event.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-thumb" />
                </span>
              </label>
            </>
          )}

          {formError && (
            <p className="form-error" role="alert">
              <Icon name="alert" size={15} />
              <span>{formError}</span>
            </p>
          )}
        </form>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={t("users.deleteTitle")}
        subtitle={deleteTarget?.username}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => void deleteUser()}
            >
              {busy ? t("common.loading") : t("users.deleteForever")}
            </button>
          </>
        }
      >
        <div className="form-stack">
          <p className="modal-text">{t("users.deleteBody")}</p>
          <Field
            label={t("users.typeToConfirm", { name: deleteTarget?.username ?? "" })}
            htmlFor="delete-user-confirm"
          >
            <input
              id="delete-user-confirm"
              className="input"
              value={deleteConfirm}
              autoComplete="off"
              onChange={(event) => setDeleteConfirm(event.target.value)}
            />
          </Field>
          {formError && (
            <p className="form-error" role="alert">
              <Icon name="alert" size={15} />
              <span>{formError}</span>
            </p>
          )}
        </div>
      </Modal>
    </section>
  );
}

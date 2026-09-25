"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { apiFetch, useApi } from "@/lib/client";
import { formatDateTime } from "@/lib/dates";
import { Badge, Button, ErrorState, Field, Modal, PageHeader, Spinner, Tabs, useToast } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { useSession } from "@/components/session";

function Users({ roles }: { roles: any[] }) {
  const toast = useToast();
  const me = useSession();
  const { data, error, reload } = useApi<any[]>("/api/users");
  const [edit, setEdit] = useState<any | null>(null);
  const [v, setV] = useState<Record<string, any>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const save = async () => {
    try {
      if (edit.id) {
        await apiFetch(`/api/users/${edit.id}`, { method: "PATCH", json: { name: v.name, email: v.email ?? "", roleId: v.roleId !== edit.role.id ? v.roleId : undefined, active: v.active, resetPassword: v.password || undefined } });
      } else {
        await apiFetch("/api/users", { method: "POST", json: { username: v.username, name: v.name, email: v.email ?? "", roleId: v.roleId, password: v.password } });
      }
      toast("success", "User saved");
      setEdit(null);
      reload();
    } catch (e: any) {
      setErrs(e.fields ?? {});
      toast("error", e.message);
    }
  };
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => { setEdit({}); setV({ roleId: roles.find((r) => r.code === "RECEPTION")?.id, active: true }); setErrs({}); }}>
          <Plus className="h-4 w-4" /> Add user
        </Button>
      </div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Role</th>
              <th>Last login</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.username}</td>
                <td>{u.role.name}</td>
                <td>{formatDateTime(u.lastLoginAt)}</td>
                <td>
                  {u.active ? <Badge tone="green">Active</Badge> : <Badge>Disabled</Badge>}
                  {u.mustChangePassword && <Badge tone="amber" className="ml-1">must change password</Badge>}
                </td>
                <td>
                  <Button size="sm" variant="ghost" onClick={() => { setEdit(u); setV({ name: u.name, email: u.email, roleId: u.role.id, active: u.active }); setErrs({}); }}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.username}` : "New user"} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        <div className="space-y-3">
          {!edit?.id && (
            <Field label="Username" required error={errs.username}>
              <input className="input" autoCapitalize="none" value={v.username ?? ""} onChange={(e) => setV({ ...v, username: e.target.value })} />
            </Field>
          )}
          <Field label="Full name" required error={errs.name}>
            <input className="input" value={v.name ?? ""} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Field>
          <Field label="Email" error={errs.email}>
            <input className="input" type="email" value={v.email ?? ""} onChange={(e) => setV({ ...v, email: e.target.value })} />
          </Field>
          <Field label="Role" required>
            <select className="input" value={v.roleId ?? ""} onChange={(e) => setV({ ...v, roleId: e.target.value })} disabled={edit?.id === me.id}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={edit?.id ? "Reset password (optional)" : "Initial password"} required={!edit?.id} error={errs.password ?? errs.resetPassword} help="User must change it at next sign-in. Min 8 characters with letters and numbers.">
            <input className="input" type="password" autoComplete="new-password" value={v.password ?? ""} onChange={(e) => setV({ ...v, password: e.target.value })} />
          </Field>
          {edit?.id && edit.id !== me.id && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> Active (disabling signs the user out everywhere)
            </label>
          )}
        </div>
      </Modal>
    </>
  );
}

function Roles({ data, reload }: { data: any; reload: () => void }) {
  const toast = useToast();
  const [roleId, setRoleId] = useState<string>(data.roles[0]?.id);
  const role = data.roles.find((r: any) => r.id === roleId);
  const [perms, setPerms] = useState<Set<string>>(new Set(role?.permissions));
  useEffect(() => setPerms(new Set(role?.permissions)), [role]);
  const groups = [...new Set(data.catalogue.map((p: any) => p.group))] as string[];
  const save = async () => {
    try {
      await apiFetch(`/api/roles/${roleId}`, { method: "PATCH", json: { permissions: [...perms] } });
      toast("success", "Permissions saved — they apply on the user's next request");
      reload();
    } catch (e: any) {
      toast("error", e.message);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input !w-auto" value={roleId} onChange={(e) => setRoleId(e.target.value)} aria-label="Role">
          {data.roles.map((r: any) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.users} users)
            </option>
          ))}
        </select>
        <span className="text-sm muted">{role?.description}</span>
        <Button className="ml-auto" onClick={save}>
          Save permissions
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <div key={g} className="card p-3">
            <p className="mb-2 text-sm font-semibold">{g}</p>
            {data.catalogue
              .filter((p: any) => p.group === g)
              .map((p: any) => (
                <label key={p.code} className="flex items-start gap-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={perms.has(p.code)}
                    onChange={(e) =>
                      setPerms((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(p.code);
                        else n.delete(p.code);
                        return n;
                      })
                    }
                  />
                  <span>
                    {p.description} <span className="text-xs muted">({p.code})</span>
                  </span>
                </label>
              ))}
          </div>
        ))}
      </div>
      <p className="text-xs muted">Permissions are enforced by the server on every request — hiding a menu item alone never grants or removes access.</p>
    </div>
  );
}

export default function UsersPage() {
  const [tab, setTab] = useState<"users" | "roles">("users");
  const roles = useApi<any>("/api/roles");
  return (
    <Guard perm="users.manage">
      <PageHeader title="Users & Permissions" />
      <div className="space-y-4">
        <Tabs value={tab} onChange={setTab} tabs={[{ key: "users", label: "Users" }, { key: "roles", label: "Roles & permissions" }]} />
        {!roles.data ? <Spinner /> : tab === "users" ? <Users roles={roles.data.roles} /> : <Roles data={roles.data} reload={roles.reload} />}
      </div>
    </Guard>
  );
}

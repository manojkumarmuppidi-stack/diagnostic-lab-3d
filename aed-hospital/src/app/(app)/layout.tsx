import { redirect } from "next/navigation";
import { getActor } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { todayISO } from "@/lib/dates";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  const settings = await getSettings();
  return (
    <AppShell
      user={{
        id: actor.id,
        name: actor.name,
        username: actor.username,
        roleCode: actor.roleCode,
        roleName: actor.roleName,
        permissions: [...actor.permissions],
        hospitalName: settings.hospitalName,
        today: todayISO(),
      }}
    >
      {children}
    </AppShell>
  );
}

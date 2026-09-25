import { api } from "@/server/api";

export const GET = api(async ({ actor }) => ({ id: actor.id, name: actor.name, username: actor.username, role: actor.roleCode, permissions: [...actor.permissions], mustChangePassword: actor.mustChangePassword }), { allowPasswordChange: true });

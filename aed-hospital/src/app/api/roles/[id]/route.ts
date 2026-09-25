import { api, readJson } from "@/server/api";
import { setRolePermissions } from "@/server/services/misc";

export const PATCH = api<{ id: string }>(async ({ actor, params, req }) => setRolePermissions(actor, params.id, await readJson(req)));

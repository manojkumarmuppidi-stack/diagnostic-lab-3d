import { api, readJson } from "@/server/api";
import { updateUser } from "@/server/services/misc";

export const PATCH = api<{ id: string }>(async ({ actor, params, req }) => updateUser(actor, params.id, await readJson(req)));

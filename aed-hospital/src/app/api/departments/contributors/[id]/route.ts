import { api, readJson } from "@/server/api";
import { deleteContributor, saveContributor } from "@/server/services/departments";

export const PATCH = api<{ id: string }>(async ({ actor, params, req }) => saveContributor(actor, params.id, await readJson(req)));
export const DELETE = api<{ id: string }>(async ({ actor, params }) => deleteContributor(actor, params.id));

import { api, readJson } from "@/server/api";
import { deleteDepartmentCost, saveDepartmentCost } from "@/server/services/departments";

export const PATCH = api<{ id: string }>(async ({ actor, params, req }) => saveDepartmentCost(actor, params.id, await readJson(req)));
export const DELETE = api<{ id: string }>(async ({ actor, params }) => deleteDepartmentCost(actor, params.id));

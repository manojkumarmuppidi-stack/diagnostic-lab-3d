import { api, readJson } from "@/server/api";
import { listDepartmentCostOptions, listDepartmentCosts, saveDepartmentCost } from "@/server/services/departments";

export const GET = api(async ({ actor, url }) => {
  const departmentId = url.searchParams.get("departmentId");
  return departmentId ? listDepartmentCosts(actor, departmentId) : listDepartmentCostOptions(actor);
});
export const POST = api(async ({ actor, req }) => saveDepartmentCost(actor, null, await readJson(req)));

import { api } from "@/server/api";
import { departmentPatients } from "@/server/services/departments";

export const GET = api(async ({ actor, url }) =>
  departmentPatients(actor, { departmentId: url.searchParams.get("departmentId"), from: url.searchParams.get("from"), to: url.searchParams.get("to") }),
);

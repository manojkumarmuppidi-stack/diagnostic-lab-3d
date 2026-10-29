import { api } from "@/server/api";
import { listStaffDepartments } from "@/server/services/departments";

export const GET = api(async ({ actor }) => listStaffDepartments(actor));

import { api } from "@/server/api";
import { deleteStaffDepartment } from "@/server/services/departments";

export const DELETE = api<{ id: string }>(async ({ actor, params }) => deleteStaffDepartment(actor, params.id));

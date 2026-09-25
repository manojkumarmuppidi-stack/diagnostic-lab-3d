import { api } from "@/server/api";
import { listRoles } from "@/server/services/misc";

export const GET = api(async ({ actor }) => listRoles(actor));

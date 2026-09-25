import { api, readJson } from "@/server/api";
import { createUser, listUsers } from "@/server/services/misc";

export const GET = api(async ({ actor }) => listUsers(actor));
export const POST = api(async ({ actor, req }) => createUser(actor, await readJson(req)));

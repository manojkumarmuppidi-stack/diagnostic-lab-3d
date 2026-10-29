import { api, readJson } from "@/server/api";
import { saveContributor } from "@/server/services/departments";

export const POST = api(async ({ actor, req }) => saveContributor(actor, null, await readJson(req)));

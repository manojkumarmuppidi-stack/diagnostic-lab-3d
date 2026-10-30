import { api, readJson } from "@/server/api";
import { settleAdmissions } from "@/server/services/ipd-settle";

export const POST = api(async ({ actor, req }) => settleAdmissions(actor, await readJson(req)));

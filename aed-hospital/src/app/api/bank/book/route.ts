import { api, readJson } from "@/server/api";
import { bookBankPayments } from "@/server/services/bank";

export const POST = api(async ({ actor, req }) => bookBankPayments(actor, await readJson(req)));

import { api } from "@/server/api";
import { importHistory } from "@/server/services/import";

export const GET = api(async ({ actor, url }) => importHistory(actor, Object.fromEntries(url.searchParams)));

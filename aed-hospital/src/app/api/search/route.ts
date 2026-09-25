import { api } from "@/server/api";
import { globalSearch } from "@/server/services/misc";

export const GET = api(async ({ actor, url }) => globalSearch(actor, url.searchParams.get("q") ?? ""));

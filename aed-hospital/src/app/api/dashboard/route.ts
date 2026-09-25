import { api } from "@/server/api";
import { getDashboard } from "@/server/services/dashboard";

export const GET = api(async ({ actor, url }) => getDashboard(actor, Object.fromEntries(url.searchParams)));

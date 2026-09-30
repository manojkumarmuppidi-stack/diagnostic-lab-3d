import { api } from "@/server/api";
import { hormonalPharmacy } from "@/server/services/hormonal-pharmacy";

export const GET = api(async ({ actor, url }) => hormonalPharmacy(actor, url.searchParams.get("month") ?? undefined));

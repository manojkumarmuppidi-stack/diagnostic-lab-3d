import { api } from "@/server/api";
import { notificationsFor } from "@/server/services/notifications";

export const GET = api(async ({ actor }) => notificationsFor(actor));

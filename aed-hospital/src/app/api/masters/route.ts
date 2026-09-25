import { api } from "@/server/api";
import { getAllMasters } from "@/server/services/masters";

// Any signed-in user may read master lists (needed by entry forms and filters).
export const GET = api(async () => getAllMasters());

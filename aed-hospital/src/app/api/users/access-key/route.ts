import { api } from "@/server/api";
import { accessKeyStatus, createAccessKey, revokeAccessKey } from "@/server/services/access-key";

export const GET = api(async ({ actor }) => accessKeyStatus(actor));
export const POST = api(async ({ actor }) => createAccessKey(actor));
export const DELETE = api(async ({ actor }) => revokeAccessKey(actor));

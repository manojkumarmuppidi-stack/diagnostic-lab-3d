import { api } from "@/server/api";
import { badRequest } from "@/server/errors";
import { addAttachment, listAttachments } from "@/server/services/misc";

export const GET = api<{ id: string }>(async ({ actor, params }) => listAttachments(actor, params.id));

export const POST = api<{ id: string }>(async ({ actor, params, req }) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("No file uploaded");
  return addAttachment(actor, params.id, file.name, Buffer.from(await file.arrayBuffer()));
});

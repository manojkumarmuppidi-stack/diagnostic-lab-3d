import { api } from "@/server/api";
import { badRequest } from "@/server/errors";
import { bookFromReviewedSheet } from "@/server/services/bank";

/** The reviewed bank payments sheet: rows marked "Yes" become expenses (re-checked, no duplicates). */
export const POST = api(async ({ actor, req }) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("No file uploaded");
  return bookFromReviewedSheet(actor, file.name, Buffer.from(await file.arrayBuffer()), { intoClosedDays: form.get("intoClosedDays") === "1" });
});

import { api } from "@/server/api";
import { badRequest } from "@/server/errors";
import { importDepartmentWorkbook } from "@/server/services/departments";

export const POST = api(async ({ actor, req }) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("No file uploaded");
  return importDepartmentWorkbook(actor, String(form.get("departmentId") ?? "") || null, file.name, Buffer.from(await file.arrayBuffer()), {
    confirmPayroll: form.get("confirmPayroll") === "1",
  });
});

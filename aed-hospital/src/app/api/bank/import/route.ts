import { api } from "@/server/api";
import { importBankStatements } from "@/server/services/bank";

/** One or more bank statement files (SBI .xls downloads). */
export const POST = api(async ({ actor, req }) => {
  const form = await req.formData();
  const files = await Promise.all(
    form
      .getAll("file")
      .filter((f): f is File => f instanceof File)
      .map(async (f) => ({ name: f.name, buf: Buffer.from(await f.arrayBuffer()) })),
  );
  return importBankStatements(actor, files);
});

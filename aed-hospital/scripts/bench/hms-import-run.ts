/* Dev harness: run OneGlance exports through upload → validate → commit (approve warnings). Usage: tsx scripts/bench/hms-import-run.ts <file.csv>... */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { prisma } from "@/server/db";
import { commitBatch, uploadFile, validateBatch } from "@/server/services/import";
import type { Actor } from "@/server/authz";

async function main() {
  const user = await prisma.user.findFirstOrThrow({ where: { username: "admin" }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  const actor: Actor = { id: user.id, username: user.username, name: user.name, roleCode: user.role.code, roleName: user.role.name, permissions: new Set(user.role.permissions.map((p) => p.permission.code)), mustChangePassword: false };
  for (const file of process.argv.slice(2)) {
    const name = basename(file).replace(/^[0-9a-f]{8}-/, "");
    let t = Date.now();
    let up;
    try {
      up = await uploadFile(actor, name, readFileSync(file));
    } catch (e) {
      console.log(`✖ ${name}: ${(e as Error).message}`);
      continue;
    }
    console.log(`\n▶ ${name}: ${up.batches.length} batches, upload ${Date.now() - t} ms`);
    console.log(`  note: ${up.batches[0]?.note}`);
    for (const b of up.batches) {
      if (b.suggestion.missingRequired.length) console.log(`  ! ${b.sheetName} missing: ${b.suggestion.missingRequired}`);
      t = Date.now();
      const v = await validateBatch(actor, b.id, { type: b.type, mapping: b.suggestion.mapping });
      const vt = Date.now() - t;
      t = Date.now();
      let c = { imported: 0 };
      try {
        c = await commitBatch(actor, b.id, { approveWarnings: true });
      } catch (e) {
        console.log(`  commit failed: ${(e as Error).message}`);
      }
      console.log(`  ${b.sheetName.padEnd(18)} rows ${String(b.rows).padStart(5)} · valid ${v.summary.valid} warn ${v.summary.warnings} invalid ${v.summary.invalid} dup ${v.summary.duplicates} · imported ${c.imported} · validate ${vt} ms commit ${Date.now() - t} ms`);
      const bad = await prisma.importRecord.findMany({ where: { batchId: b.id, status: { in: ["INVALID", "DUPLICATE"] } }, take: 3 });
      for (const r of bad) console.log(`     ${r.status} row ${r.rowNumber}: ${JSON.stringify(r.errors)} ${JSON.stringify(r.warnings)?.slice(0, 200)}`);
      const w = await prisma.importRecord.findFirst({ where: { batchId: b.id, status: "IMPORTED", NOT: { warnings: { equals: [] } } } });
      if (w) console.log(`     sample warning: ${JSON.stringify(w.warnings).slice(0, 240)}`);
    }
  }
  await prisma.$disconnect();
}
main();

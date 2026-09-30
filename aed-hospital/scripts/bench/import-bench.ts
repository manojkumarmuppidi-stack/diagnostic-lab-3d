/** Benchmark: validate + commit a synthetic N-row lab import (run against a scratch database only). */
import { prisma } from "../../src/server/db";
import { uploadFile, validateBatch, commitBatch, reverseBatch } from "../../src/server/services/import";
import type { Actor } from "../../src/server/authz";

async function main() {
  const n = Number(process.argv[2] || 5000);
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { code: "ADMIN" } }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  const actor: Actor = { id: admin.id, username: admin.username, name: admin.name, roleCode: "ADMIN", roleName: "Admin", permissions: new Set(admin.role.permissions.map((p) => p.permission.code)), mustChangePassword: false };
  const tests = ["ECG", "Diabetic Profile", "Fundus", "X-Ray", "TMT"];
  const lines = ["Date,Patient ID,Patient Name,Test Name,Qty,Amt,Mode"];
  for (let i = 0; i < n; i++) {
    const day = 1 + (i % 28), month = 1 + (Math.floor(i / 28) % 12);
    lines.push(`${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/2025,BENCH-${i % 900},Bench Patient ${i % 900},${tests[i % 5]},1,${300 + (i % 7) * 100},${["Cash", "UPI", "Card"][i % 3]}`);
  }
  let t = Date.now();
  const up = await uploadFile(actor, "bench.csv", Buffer.from(lines.join("\n")), "lab");
  const b = up.batches[0];
  console.log(`upload   ${Date.now() - t} ms`);
  t = Date.now();
  const v = await validateBatch(actor, b.id, { type: "lab", mapping: b.suggestion.mapping });
  console.log(`validate ${Date.now() - t} ms  valid=${v.summary.valid} dup=${v.summary.duplicates}`);
  t = Date.now();
  const c = await commitBatch(actor, b.id, { approveWarnings: true });
  console.log(`commit   ${Date.now() - t} ms  imported=${c.imported}`);
  await reverseBatch(actor, b.id, { reason: "benchmark cleanup" });
  await prisma.$disconnect();
}
main();

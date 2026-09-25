import bcrypt from "bcryptjs";

export function hashPasswordSync(pw: string): string {
  return bcrypt.hashSync(pw, 12);
}

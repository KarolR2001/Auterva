import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().startsWith("postgresql://"),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
});

export function parseServerEnv(source: Record<string, string | undefined>) {
  const result = schema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid server configuration: ${fields}`);
  }
  return result.data;
}

export function getServerEnv() {
  return parseServerEnv(process.env);
}

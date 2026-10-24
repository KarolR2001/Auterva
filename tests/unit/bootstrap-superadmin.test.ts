import { PassThrough } from "node:stream";
import { expect, test, vi } from "vitest";
import { readHiddenLine } from "../../scripts/bootstrap-superadmin";

test("interactive password input never echoes or persists the entered secret", async () => {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn() });
  const output = new PassThrough();
  let visible = "";
  output.on("data", (chunk) => { visible += chunk.toString(); });
  const result = readHiddenLine(input, output, "Password: ");
  input.write("Secret password 9384!\n");
  expect(await result).toBe("Secret password 9384!");
  expect(visible).toBe("Password: \n");
  expect(input.setRawMode).toHaveBeenCalledWith(true);
  expect(input.setRawMode).toHaveBeenLastCalledWith(false);
});

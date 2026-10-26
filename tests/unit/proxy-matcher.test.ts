import { expect, test } from "vitest";
import { config } from "../../src/proxy";

// Streaming upload routes must bypass Proxy (it buffers bodies); every other route must stay behind it.
const matcher = new RegExp(`^${config.matcher[0]}$`);
const proxied = (path: string) => matcher.test(path);
const id = "11111111-1111-4111-8111-111111111111";

test.each([
  `/api/admin/vehicles/${id}/images/`, `/api/admin/vehicles/${id}/images`,
  `/api/platform/companies/${id}/vehicles/${id}/images/`,
  `/api/platform/companies/${id}/public-media/logo/`, `/api/platform/companies/${id}/public-media/hero`,
  `/api/platform/companies/${id}/public-media/brand/`,
])("upload route %s bypasses Proxy", (path) => expect(proxied(path)).toBe(false));

test.each([
  "/", "/api/admin/settings/", `/api/platform/companies/${id}/settings/`,
  `/api/platform/companies/${id}/public-media/${id}/`, `/api/platform/companies/${id}/public-media/banner/`,
  `/api/platform/companies/${id}/public-media/logo/extra/`, "/api/public/settings/",
])("%s stays behind Proxy", (path) => expect(proxied(path)).toBe(true));

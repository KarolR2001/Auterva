import { expect, test } from "vitest";
import { DEFAULT_WS_PORT, parseRealtimeConfig } from "../../src/modules/chat/realtime-config";

test("defaults to loopback and the expected loopback authority", () => {
  const config = parseRealtimeConfig({});
  expect(config.host).toBe("127.0.0.1");
  expect(config.port).toBe(DEFAULT_WS_PORT);
  expect([...config.allowedHosts]).toEqual([`127.0.0.1:${DEFAULT_WS_PORT}`]);
  expect([...parseRealtimeConfig({ WS_PORT: "25111", WS_HOST: "  " }).allowedHosts]).toEqual(["127.0.0.1:25111"]);
});

test("an explicit list replaces the default and is normalised to lowercase exact authorities", () => {
  const config = parseRealtimeConfig({ WS_HOST: "0.0.0.0", WS_PORT: "3101",
    WS_ALLOWED_HOSTS: " Admin.Company-A.Localhost:3101 , panel.example.test ,panel.example.test" });
  expect(config.host).toBe("0.0.0.0");
  expect([...config.allowedHosts].sort()).toEqual(["admin.company-a.localhost:3101", "panel.example.test"]);
});

test("a listener reachable from outside must name its hosts; there is no any-host mode", () => {
  for (const host of ["0.0.0.0", "::", "10.1.2.3"]) {
    expect(() => parseRealtimeConfig({ WS_HOST: host })).toThrow("Invalid server configuration: WS_ALLOWED_HOSTS");
  }
  for (const entry of ["*", "*.example.test", "https://panel.example.test", "panel.example.test/ws", "a b.example.test",
    "panel.example.test:0", "panel.example.test:70000", "[::1]:3101", ",", "panel.example.test,,other.example.test"]) {
    expect(() => parseRealtimeConfig({ WS_HOST: "0.0.0.0", WS_ALLOWED_HOSTS: entry })).toThrow("Invalid server configuration: WS_ALLOWED_HOSTS");
  }
  expect(() => parseRealtimeConfig({ WS_ALLOWED_HOSTS: Array.from({ length: 51 }, (_, index) => `h${index}.example.test`).join(",") }))
    .toThrow("WS_ALLOWED_HOSTS");
});

test("invalid port or listen address is a startup error naming only the variable", () => {
  for (const port of ["0", "65536", "abc", "-1", "3101.5", "03101"]) {
    expect(() => parseRealtimeConfig({ WS_PORT: port })).toThrow("Invalid server configuration: WS_PORT");
  }
  for (const host of ["localhost", "example.test", "999.1.1.1", "0.0.0.0:80"]) {
    expect(() => parseRealtimeConfig({ WS_HOST: host })).toThrow("Invalid server configuration: WS_HOST");
  }
});

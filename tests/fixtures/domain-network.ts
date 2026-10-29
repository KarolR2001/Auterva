import { execFileSync } from "node:child_process";
import { createSocket, type Socket } from "node:dgram";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resolver } from "node:dns/promises";

// Controlled, real network fixtures: a UDP DNS responder and HTTPS servers on loopback.
// Loopback access exists only here, via an injected address policy; production keeps its own.

export type Zone = {
  txt?: Record<string, string[]>;
  cname?: Record<string, string>;
  a?: Record<string, string | string[]>;
};

function encodeName(name: string): Buffer {
  return Buffer.concat([...name.split("."), ""].map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])));
}

export async function startDnsServer(zone: Zone): Promise<{ resolver: Resolver; port: number; close: () => void }> {
  const socket: Socket = createSocket("udp4");
  socket.on("message", (message, remote) => {
    let offset = 12;
    const labels: string[] = [];
    while (message[offset] !== 0) { labels.push(message.subarray(offset + 1, offset + 1 + message[offset]).toString()); offset += message[offset] + 1; }
    const name = labels.join(".").toLowerCase();
    const type = message.readUInt16BE(offset + 1);
    const question = message.subarray(12, offset + 5);
    const answers: Buffer[] = [];
    const rr = (rtype: number, data: Buffer) => {
      const head = Buffer.alloc(10);
      head.writeUInt16BE(rtype, 0); head.writeUInt16BE(1, 2); head.writeUInt32BE(60, 4); head.writeUInt16BE(data.length, 8);
      answers.push(Buffer.concat([Buffer.from([0xc0, 0x0c]), head, data]));
    };
    if (type === 16) for (const value of zone.txt?.[name] ?? []) rr(16, Buffer.concat([Buffer.from([value.length]), Buffer.from(value)]));
    if (type === 5 && zone.cname?.[name]) rr(5, encodeName(zone.cname[name]));
    if (type === 1 && zone.a?.[name]) for (const ip of [zone.a[name]].flat()) rr(1, Buffer.from(ip.split(".").map(Number)));
    const known = [zone.txt, zone.cname, zone.a].some((table) => table && name in table);
    const header = Buffer.alloc(12);
    header.writeUInt16BE(message.readUInt16BE(0), 0);
    header.writeUInt16BE(0x8180 | (known ? 0 : 3), 2);
    header.writeUInt16BE(1, 4); header.writeUInt16BE(answers.length, 6);
    socket.send(Buffer.concat([header, question, ...answers]), remote.port, remote.address);
  });
  await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  const resolver = new Resolver({ timeout: 1_500, tries: 1 });
  resolver.setServers([`127.0.0.1:${port}`]);
  return { resolver, port, close: () => socket.close() };
}

export type TestPki = {
  ca: string;
  issue(hostname: string): { key: string; cert: string };
  selfSigned(hostname: string): { key: string; cert: string };
  dispose(): void;
};

export function createTestPki(): TestPki {
  const dir = mkdtempSync(join(tmpdir(), "auterva-pki-"));
  const run = (...args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
  run("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "2", "-subj", "/CN=Auterva test CA");
  let serial = 1;
  const leaf = (hostname: string, signer: "ca" | "self") => {
    const id = `leaf${serial++}`;
    writeFileSync(join(dir, `${id}.ext`), `subjectAltName=DNS:${hostname}\nbasicConstraints=CA:FALSE\n`);
    run("req", "-newkey", "rsa:2048", "-nodes", "-keyout", `${id}.key`, "-out", `${id}.csr`, "-subj", `/CN=${hostname}`);
    if (signer === "ca") run("x509", "-req", "-in", `${id}.csr`, "-CA", "ca.pem", "-CAkey", "ca.key", "-set_serial", String(serial), "-out", `${id}.pem`, "-days", "2", "-extfile", `${id}.ext`);
    else run("x509", "-req", "-in", `${id}.csr`, "-signkey", `${id}.key`, "-out", `${id}.pem`, "-days", "2", "-extfile", `${id}.ext`);
    return { key: readFileSync(join(dir, `${id}.key`), "utf8"), cert: readFileSync(join(dir, `${id}.pem`), "utf8") };
  };
  return { ca: readFileSync(join(dir, "ca.pem"), "utf8"), issue: (host) => leaf(host, "ca"),
    selfSigned: (host) => leaf(host, "self"), dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

export async function startHttpsServer(credentials: { key: string; cert: string },
  handler: (host: string, path: string) => Promise<{ status: number; body: string }> | { status: number; body: string }):
  Promise<{ port: number; close: () => Promise<void> }> {
  const server: Server = createServer(credentials, async (request, response) => {
    const result = await handler(request.headers.host ?? "", request.url ?? "");
    response.writeHead(result.status, { "content-type": "application/json" });
    response.end(result.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { port, close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }) };
}

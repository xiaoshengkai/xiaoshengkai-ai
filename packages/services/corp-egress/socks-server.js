/**
 * 最小 SOCKS5 服务器（仅 CONNECT、无认证）
 * ============================================================================
 *
 * 为什么不用 `ssh -D`：`ssh -D` 的 SOCKS 出口在 **ssh 服务器侧** 出网。本服务的
 * 目的是让云服务器的流量经由「Mac 的公司网络」出去，因此必须在 Mac 本地起一个
 * 真正从本机出网的 SOCKS，再用 `ssh -R` 把它反投给服务器。
 *
 * 仅支持 CONNECT（IPv4 / 域名 / IPv6），够用；不做认证（只绑回环 + 隧道内）。
 */
import net from "node:net";

function reply(socket, code) {
  if (!socket.writable) return;
  // ver=5, rep=code, rsv=0, atyp=1(IPv4), bnd.addr=0.0.0.0, bnd.port=0
  socket.write(Buffer.from([0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
}

function parseRequest(buf) {
  if (buf[0] !== 0x05 || buf[1] !== 0x01) return null; // 只处理 CONNECT
  const atyp = buf[3];
  let host;
  let offset;
  if (atyp === 0x01) {
    host = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;
    offset = 8;
  } else if (atyp === 0x03) {
    const len = buf[4];
    host = buf.subarray(5, 5 + len).toString();
    offset = 5 + len;
  } else if (atyp === 0x04) {
    const parts = [];
    for (let i = 0; i < 8; i++) parts.push(buf.readUInt16BE(4 + i * 2).toString(16));
    host = parts.join(":");
    offset = 20;
  } else {
    return null;
  }
  const port = buf.readUInt16BE(offset);
  return { host, port };
}

export function createSocksServer({ host = "127.0.0.1", port }) {
  const server = net.createServer((client) => {
    client.on("error", () => client.destroy());
    client.once("data", (greeting) => {
      if (greeting[0] !== 0x05) return client.destroy();
      client.write(Buffer.from([0x05, 0x00])); // 无认证
      client.once("data", (req) => {
        const parsed = parseRequest(req);
        if (!parsed) return reply(client, 0x07); // command not supported
        let responded = false;
        const fail = (code) => {
          if (responded) return;
          responded = true;
          reply(client, code);
          client.destroy();
        };
        const upstream = net.connect(parsed.port, parsed.host);
        // 上游 10s 上限：黑洞连接（不可路由）快速失败，而非 hang 满客户端超时
        upstream.setTimeout(10000);
        upstream.once("connect", () => {
          responded = true;
          upstream.setTimeout(0);
          reply(client, 0x00);
          upstream.pipe(client);
          client.pipe(upstream);
        });
        upstream.once("timeout", () => {
          fail(0x05);
          upstream.destroy();
        });
        upstream.once("error", () => {
          if (responded) {
            upstream.destroy();
            client.destroy();
            return;
          }
          fail(0x05);
        });
        client.on("close", () => upstream.destroy());
      });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

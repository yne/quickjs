#!/usr/bin/env qjs
///@ts-check
/// <reference path="../doc/globals.d.ts" />
/// <reference path="../doc/os.d.ts" />
/// <reference path="../doc/std.d.ts" />
import * as os from "os";
import * as std from "std";// for std.strerror

const MIMES = new Map([
    ['html', 'text/html'],
    ['txt', 'text/plain'],
    ['css', 'text/css'],
    ['c', 'text/plain'],
    ['h', 'text/plain'],
    ['json', 'application/json'],
    ['mjs', 'application/javascript'],
    ['js', 'application/javascript'],
    ['', 'application/octet-stream'],
]);
/** @template T @param {os.Result<T>} result */
function must(result) {
    if (typeof result === "number" && result < 0) throw new Error(std.strerror(-result));
    return /** @type {T} */ (result)
}
//USAGE: qjs http_server.js [PORT=8080 [HOST=localhost]]
const [port = "8080", host = "localhost"] = scriptArgs.slice(1);
const [addrInfo] = must(os.getaddrinfo(host, { service: port }));
const sock_srv = must(os.socket(addrInfo.family, addrInfo.socktype));
must(os.setsockopt(sock_srv, os.SO_REUSEADDR, new Uint32Array([1]).buffer));
must(os.bind(sock_srv, addrInfo));
must(os.listen(sock_srv));
//os.signal(os.SIGINT, ()=>os.close(sock_srv)); // don't work
console.log(`Listening on http://${host}:${port} (${addrInfo.addr}:${addrInfo.port}) ...`);
const openCmd = { linux: "xdg-open", darwin: "open", win32: "start" }[os.platform];
if (openCmd && os.exec) os.exec([openCmd, `http://${host}:${port}`]);
while (true) { // TODO: break on SIG*
    const [sock_cli] = await os.accept(sock_srv);

    const hdrBuf = new Uint8Array(4000);
    const hdrLen = await os.recv(sock_cli, hdrBuf.buffer);
    const [requestLine, ...hdrLines] = std.encode(hdrBuf.buffer.slice(0, hdrLen)).split("\r\n");
    const [method, _path, version] = requestLine.split(' ');
    //const headers = new Map(hdrLines.map(hrd => hrd.split(":")).map(([key, ...vals]) => [key, vals.join(':')]));
    let safe_path = '.' + _path.replaceAll(/\.+/g, '.');

    let [obj, err] = os.stat(safe_path);
    if (obj?.mode & os.S_IFDIR && safe_path.endsWith('/') && os.stat(safe_path + 'index.html')[0]) {
        safe_path += 'index.html';
        [obj, err] = os.stat(safe_path);
    }
    /** @param {os.FileDescriptor} fd @param {number} code @param {string[]} headers @param {string} body */
    async function reply(fd, code, headers = [], body = "") {
        console.log(method.padEnd(6), _path.padEnd(25), '=>', code, headers.join(';'))
        await os.send(fd, std.decode([`HTTP/1.1 ${code}`, ...headers, '', body].join('\r\n')));
    }
    if (err) {
        await reply(sock_cli, 404, [], `${safe_path} errno:${err}`)
    } else if (obj?.mode & os.S_IFDIR) {
        if (!safe_path.endsWith('/'))
            await reply(sock_cli, 301, [`Location: ${safe_path}/`]);
        else
            await reply(sock_cli, 200, ['Content-Type: text/html'],
                os.readdir(safe_path)[0]?.filter(e => e[0] != '.').map(e => `<li><a href="${e}">${e}</a></li>`).join('')
            );
    } else {
        const mime = MIMES.get(safe_path.split('.').at(-1) || '') || MIMES.get('');
        await reply(sock_cli, 200, [`Content-Type: ${mime}`]);
        const fd = must(os.open(safe_path));
        const fbuf = new Uint8Array(4096);
        for (let got = 0; (got = os.read(fd, fbuf.buffer, 0, fbuf.byteLength)) > 0;) {
            await os.send(sock_cli, fbuf.buffer, got);
        }
    }

    os.close(sock_cli);
}

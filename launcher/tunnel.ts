// Cloudflare Quick Tunnel: an HTTPS URL for the viewer server that works from
// anywhere, including a phone on mobile data with nothing installed.
//
// Why this and not Tailscale: the requirement is that the launcher carries its
// own tunnel. `tailscale.exe` cannot do that — it is a thin client for a
// `tailscaled` daemon that needs a TUN driver, a service install and an account
// login, so shipping it would mean shipping an installer. cloudflared is a
// single static binary and its account-less Quick Tunnel needs no login at all,
// which is what makes the "scan the QR and it opens" flow possible.
//
// The trade-offs are real and are stated in the UI: a Quick Tunnel is on the
// public internet, has no uptime guarantee, and gets a fresh random hostname
// every run. The last part is a feature here — it expires old links for free,
// the same way the viewer token does.
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Embedded by `bun build --compile`, so the shipped exe contains cloudflared and
// needs nothing installed on the machine it runs on. launcher/build.ts fetches
// and hash-verifies this file first (fetch-cloudflared.ts).
import cloudflaredAsset from './bin/cloudflared.exe' with { type: 'file' };

// The binary has to exist as a real file to be executed, and inside a compiled
// exe it is a virtual path. Materialise it once per version into the temp
// directory; the version in the name is what makes a stale copy from an older
// build impossible to pick up.
const MATERIALISED_NAME = 'modbus-simple-logger-cloudflared-2026.7.3.exe';

const materialise = async (): Promise<string> => {
  const dir = join(tmpdir(), 'modbus-simple-logger');
  const path = join(dir, MATERIALISED_NAME);
  if (existsSync(path)) return path;
  mkdirSync(dir, { recursive: true });
  await Bun.write(path, Bun.file(cloudflaredAsset));
  try {
    chmodSync(path, 0o755);
  } catch {
    // Windows has no exec bit; the write above is enough there.
  }
  return path;
};

// cloudflared prints the assigned hostname into its log stream a few seconds
// after start, inside an ASCII banner. The hostname shape is fixed and
// specific, so matching it directly is more robust than trying to parse the
// banner's box drawing.
const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

// Generous, because this covers DNS, QUIC setup and Cloudflare's own
// provisioning. Failing here is not fatal to the app — the user is told and can
// fall back to LAN sharing.
const START_TIMEOUT_MS = 45000;

export type TunnelHandle = {
  url: string;
  stop: () => void;
};

/**
 * Publish `port` (loopback) as an HTTPS URL. Rejects with a message meant for
 * the user: the Remote Monitoring panel is the only place this can surface.
 *
 * `onUnexpectedExit` fires if cloudflared dies on its own — the link is dead at
 * that point, and the panel has to say so rather than keep showing a URL and a
 * QR code that no longer resolve.
 */
export const startTunnel = async (
  port: number,
  onUnexpectedExit?: () => void,
): Promise<TunnelHandle> => {
  const binary = await materialise();
  const child = Bun.spawn(
    [binary, 'tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'],
    {
      stdout: 'pipe',
      stderr: 'pipe',
      // cloudflared is a console-subsystem binary and the launcher is a GUI one,
      // so without this Windows allocates a console and shows an empty terminal
      // window next to the app. It is not just ugly: closing that window kills
      // cloudflared and silently takes the link down, which is impossible to
      // explain to someone who did not know the window was part of the app.
      windowsHide: true,
    },
  );

  // Set once we stop it deliberately, so a kill from stop() is not reported back
  // to the user as a failure.
  let stopping = false;
  const kill = () => {
    stopping = true;
    try {
      child.kill();
    } catch {
      // already gone
    }
  };

  // cloudflared logs to stderr; stdout is read too so a full pipe buffer can
  // never stall the process.
  const url = await new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => {
        kill();
        reject(new Error('The tunnel did not come up within 45 seconds. Check this PC\'s internet connection.'));
      });
    }, START_TIMEOUT_MS);

    const scan = async (stream: ReadableStream<Uint8Array>) => {
      const decoder = new TextDecoder();
      for await (const chunk of stream) {
        const match = URL_PATTERN.exec(decoder.decode(chunk));
        if (match) {
          finish(() => resolve(match[0]));
          return;
        }
      }
    };
    void scan(child.stderr as ReadableStream<Uint8Array>);
    void scan(child.stdout as ReadableStream<Uint8Array>);

    void child.exited.then((code) => {
      finish(() => reject(new Error(`The tunnel process exited before it was ready (code ${code}).`)));
    });
  });

  // Only armed after the URL was handed out: before that, an exit is reported by
  // the promise above instead.
  void child.exited.then(() => {
    if (!stopping) onUnexpectedExit?.();
  });

  return { url, stop: kill };
};

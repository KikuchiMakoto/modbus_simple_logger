// Build-time download of the cloudflared binary that gets embedded in the exe.
//
// Remote monitoring can publish over a Cloudflare Quick Tunnel, which needs the
// cloudflared binary present. It is downloaded here rather than committed
// because it is 54 MB of third-party build output — `launcher/bin/` is
// gitignored for exactly this reason — and fetched at *build* time rather than
// at runtime so the shipped exe keeps its "no network dependency to start"
// property: by the time a user runs it, cloudflared is already inside.
//
// Pinned by version and verified by hash. An unpinned "latest" download would
// make two builds of the same commit produce different executables, and a
// binary we are about to embed and execute is the last place to accept whatever
// the network happens to hand back.
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const VERSION = '2026.7.3';
const SHA256 = '8635da433b6df8194746e88ed9d2589566c20e38bfc2a80e431a348b7c765841';
const URL = `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/cloudflared-windows-amd64.exe`;

const BIN_DIR = resolve(import.meta.dir, 'bin');
export const CLOUDFLARED_PATH = resolve(BIN_DIR, 'cloudflared.exe');

const sha256 = async (path: string): Promise<string> => {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(await Bun.file(path).bytes());
  return hasher.digest('hex');
};

export const ensureCloudflared = async (): Promise<void> => {
  if (existsSync(CLOUDFLARED_PATH)) {
    const actual = await sha256(CLOUDFLARED_PATH);
    if (actual === SHA256) {
      console.log(`[fetch-cloudflared] cloudflared ${VERSION} already present.`);
      return;
    }
    console.log('[fetch-cloudflared] Existing binary does not match the pinned hash; re-downloading.');
  }

  mkdirSync(BIN_DIR, { recursive: true });
  console.log(`[fetch-cloudflared] Downloading cloudflared ${VERSION} (~54 MB)...`);
  const response = await fetch(URL);
  if (!response.ok) {
    throw new Error(`[fetch-cloudflared] Download failed: ${response.status} ${response.statusText}`);
  }
  await Bun.write(CLOUDFLARED_PATH, await response.arrayBuffer());

  const actual = await sha256(CLOUDFLARED_PATH);
  if (actual !== SHA256) {
    throw new Error(
      `[fetch-cloudflared] Hash mismatch for cloudflared ${VERSION}.\n  expected ${SHA256}\n  actual   ${actual}`,
    );
  }
  console.log(`[fetch-cloudflared] Verified -> ${CLOUDFLARED_PATH}`);
};

// Runnable directly (`bun run launcher/fetch-cloudflared.ts`) as well as
// importable from build.ts.
if (import.meta.main) {
  await ensureCloudflared();
}

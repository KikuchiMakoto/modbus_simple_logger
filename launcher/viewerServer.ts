// Optional public-facing server for read-only remote monitoring.
//
// Unlike the app server this one binds every interface, so it deliberately
// exposes strictly less: the static app shell, and a push-only `__viewer`
// WebSocket. There is no MCP bridge and no `__feed` here, so a remote page has
// no path to the hardware even though it is running the same bundle. The MCP
// endpoint (mcp.ts), which does have write tools, stays on 127.0.0.1.
//
// Off by default; the host page turns it on (see hostFeed.ts).
import { networkInterfaces } from 'node:os';
import { BASE_PATH, serveStatic, type Assets } from './server';
import { viewerHub, VIEWER_PATH_SUFFIX } from './viewerHub';
import { hostFeed } from './hostFeed';

// Fixed so the URL a user hands to a colleague stays valid across restarts.
// Adjacent to the MCP port (8765) purely as a mnemonic; they share nothing else.
export const VIEWER_PORT = 8766;

export const VIEWER_PATH = `${BASE_PATH}${VIEWER_PATH_SUFFIX}`;

// A random token, minted once per launcher process, that the viewer URL carries
// as `?k=`. It gates the WebSocket upgrade, not the static assets: the assets
// are just the app shell with no measurement data in them, and gating them too
// would mean every chunk, font and wasm request had to carry the token. So an
// unauthorised visitor can load an empty UI and learn nothing from it.
//
// This is a "don't hand your data to whoever finds the port" control, not
// authentication — the transport is plain HTTP on a LAN. Anything stronger
// belongs with the tunnel (Tailscale Serve), not here.
const mintToken = (): string => {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

export const VIEWER_TOKEN = mintToken();

// Who may reach the viewer at all, checked before the token and before a single
// asset is served. Binding 0.0.0.0 is what makes the app reachable from the next
// desk; this is what keeps "the next desk" from meaning "anything that can route
// a packet here". A home/office LAN is the intended scope, so the allowlist is
// 192.168.0.0/16 plus loopback (the host's own browser, for previewing the
// viewer page).
//
// Widening this is a one-line change — 10.0.0.0/8 and 172.16.0.0/12 are the
// obvious candidates for a larger site network. Note that a tunnel (Tailscale
// Serve/Funnel) terminates locally and would arrive here as 127.0.0.1, so it
// passes this check without weakening it: the tunnel does its own access
// control upstream.
const ALLOWED_CIDRS: [string, number][] = [
  ['192.168.0.0', 16],
  ['127.0.0.0', 8],
];

const ipv4ToInt = (ip: string): number | null => {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
};

const inRange = (ip: number, [network, bits]: [string, number]): boolean => {
  const base = ipv4ToInt(network);
  if (base === null) return false;
  // `>>> 0` because a /0-style mask would overflow the sign bit; the shift is
  // done in 32-bit space either way.
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((base & mask) >>> 0);
};

/**
 * Whether `address` (as Bun reports the peer) is inside the allowlist. IPv6 is
 * rejected except for the v4-mapped form a dual-stack client can arrive as:
 * the server binds an IPv4 wildcard, so anything else is unexpected and refused
 * rather than parsed.
 */
export const isAllowedRemote = (address: string | undefined): boolean => {
  if (!address) return false;
  const plain = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  if (plain === '::1') return true;
  const ip = ipv4ToInt(plain);
  if (ip === null) return false;
  return ALLOWED_CIDRS.some((cidr) => inRange(ip, cidr));
};

// Every address another machine could plausibly reach this host on. Shown to the
// user rather than guessed at: a PC on both Wi-Fi and Ethernet has more than
// one, and only the person looking at it knows which network the viewer is on.
const localAddresses = (): string[] => {
  const found: string[] = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      found.push(address.address);
    }
  }
  return found;
};

// Filtered by the same allowlist that guards the server: an address the viewer
// would be refused from is worse than no address at all, because it sends the
// user chasing a firewall problem that is really a policy one.
export const viewerUrls = (port: number): string[] =>
  localAddresses()
    .filter((host) => isAllowedRemote(host))
    .map((host) => `http://${host}:${port}${BASE_PATH}?k=${VIEWER_TOKEN}`);

export type ViewerServerHandle = { stop: () => void; port: number };

/**
 * Start the viewer server, or throw with a message meant for the user: the only
 * place this can be surfaced is the host page's Remote Monitoring panel.
 */
export const startViewerServer = (assets: Assets): ViewerServerHandle => {
  try {
    const http = Bun.serve({
      // Every interface: this is the one endpoint that is supposed to be
      // reachable from another machine.
      hostname: '0.0.0.0',
      port: VIEWER_PORT,
      // Viewer sockets are push-only, so a quiet measurement would otherwise
      // look idle and be closed after 120s.
      idleTimeout: 0,
      fetch(req, srv) {
        // Network scope first: an address outside the allowlist gets the same
        // answer for every path, so the port reveals nothing about what is
        // behind it.
        if (!isAllowedRemote(srv.requestIP(req)?.address)) {
          return new Response('Forbidden', { status: 403 });
        }

        const url = new URL(req.url);
        const path = decodeURIComponent(url.pathname);

        if (path === VIEWER_PATH) {
          if (url.searchParams.get('k') !== VIEWER_TOKEN) {
            return new Response('Forbidden', { status: 403 });
          }
          if (srv.upgrade(req)) return undefined;
          return new Response('Expected a WebSocket upgrade', { status: 426 });
        }

        return serveStatic(assets, path, req, 'viewer');
      },
      websocket: {
        open(ws) {
          viewerHub.attach(ws);
          hostFeed.refreshViewerCount();
        },
        // Deliberately empty: the feed is one-way. Nothing a viewer sends is
        // parsed, so there is no frame it could send that reaches the host page
        // or the hardware. This is the enforcement point for "read-only" —
        // hiding buttons in the viewer UI is presentation, not a boundary.
        message() {},
        close(ws) {
          viewerHub.detach(ws);
          hostFeed.refreshViewerCount();
        },
      },
    });
    return {
      port: http.port ?? VIEWER_PORT,
      stop: () => {
        viewerHub.closeAll();
        http.stop(true);
      },
    };
  } catch {
    // EADDRINUSE is the expected case: a second instance of the app, or an
    // unrelated service already on the port.
    throw new Error(
      `Port ${VIEWER_PORT} is already in use — another instance of the app may already be sharing its screen.`,
    );
  }
};

// Optional outward-facing server for read-only remote monitoring.
//
// It deliberately exposes strictly less than the app server: the static app
// shell, and a push-only `__viewer` WebSocket. There is no control channel and no
// `__feed` here, so a remote page has no path to the hardware even though it is
// running the same bundle. The loopback app server (server.ts), which does carry write
// tools, stays on 127.0.0.1.
//
// Two ways to reach it, chosen by the user (see ViewerMode):
//   'lan'    — bound to every interface, reachable directly from the local
//              network. Works with no internet connection.
//   'tunnel' — bound to loopback only, published as HTTPS by a Cloudflare Quick
//              Tunnel (tunnel.ts). Nothing listens on the LAN at all.
//
// Off by default; the host page turns it on (see hostFeed.ts).
import { networkInterfaces } from 'node:os';
import { BASE_PATH, serveStatic, type Assets } from './server';
import { viewerHub, VIEWER_PATH_SUFFIX } from './viewerHub';
import { hostFeed } from './hostFeed';

// Fixed so the URL a user hands to a colleague stays valid across restarts.
// Adjacent to the single-instance lock port (8764) purely as a mnemonic; they share nothing else.
export const VIEWER_PORT = 8766;

export const VIEWER_PATH = `${BASE_PATH}${VIEWER_PATH_SUFFIX}`;

/** How the viewer server is reached. Decides what it binds and who may talk to it. */
export type ViewerMode = 'lan' | 'tunnel';

// A random token, minted once per launcher process, that the viewer URL carries
// as `?k=`. Nothing is served without it — not the HTML, not a single chunk.
//
// It only has to appear in the URL once: the first request that presents a valid
// token gets it back as a cookie, and the assets that follow are authorised by
// that. Requiring `?k=` on every request would mean rewriting every asset URL in
// the bundle, and putting the token in the page would leak it to anything that
// can read the DOM.
//
// In tunnel mode this is the whole boundary — a Quick Tunnel URL is on the
// public internet — which is why it is 96 bits of randomness and why it is
// reminted on every launch rather than persisted.
const mintToken = (): string => {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

export const VIEWER_TOKEN = mintToken();

// Who may reach the viewer at all, checked before the token and before a single
// asset is served.
//
// LAN mode accepts any IPv4 peer, because there is no address range that
// reliably means "the local network". A campus or lab network hands out globally
// routable addresses carved into small subnets (157.82.159.64/26 and the like),
// and an overlay such as Tailscale presents its interface as a /32 in CGNAT
// space — deriving an allowlist from this host's own interfaces would exclude
// every Tailscale peer and every neighbouring subnet, which reads to the user as
// a firewall fault rather than a policy decision. A range check that is wrong on
// the networks this app is actually used on is worse than none: it silently
// breaks the feature while implying a protection it never provided.
//
// The token is the boundary in this mode, as it already is in tunnel mode. What
// LAN mode still gives you over a tunnel is that the address is only routable
// from wherever this host is routable, and that no third party carries the
// traffic.
//
// In tunnel mode nothing listens on the LAN at all: cloudflared terminates the
// connection locally and arrives here as 127.0.0.1, so loopback alone is the
// correct — and tightest — allowlist. The access boundary there is the token,
// because the tunnel's own URL is public by design.
const ALLOWED_CIDRS: Record<ViewerMode, [string, number][]> = {
  lan: [['0.0.0.0', 0]],
  tunnel: [['127.0.0.0', 8]],
};

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
 * Whether `address` (as Bun reports the peer) is inside the allowlist for `mode`.
 * IPv6 is rejected except for the v4-mapped and loopback forms a dual-stack
 * client can arrive as: the server binds an IPv4 address, so anything else is
 * unexpected and refused rather than parsed.
 */
export const isAllowedRemote = (address: string | undefined, mode: ViewerMode): boolean => {
  if (!address) return false;
  const plain = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  if (plain === '::1') return true;
  const ip = ipv4ToInt(plain);
  if (ip === null) return false;
  return ALLOWED_CIDRS[mode].some((cidr) => inRange(ip, cidr));
};

// Every address another machine could plausibly reach this host on. Shown to the
// user rather than guessed at: a PC on Wi-Fi, Ethernet and Tailscale at once has
// several, and only the person looking at it knows which network the viewer is
// on. 169.254.0.0/16 is the one exclusion — an APIPA address means that adapter
// never got a lease, so it is unreachable by construction rather than by policy.
const localAddresses = (): string[] => {
  const found: string[] = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      if (address.address.startsWith('169.254.')) continue;
      found.push(address.address);
    }
  }
  return found;
};

/** The one URL a viewer opens, with the token that unlocks the first request. */
export const viewerUrl = (origin: string): string => `${origin}${BASE_PATH}?k=${VIEWER_TOKEN}`;

// One URL per interface, unfiltered: LAN mode refuses nothing by address, so
// every address listed here is one the server would actually answer on. Which of
// them a given viewer can route to is a question about the network, not about
// this app, so all of them are offered rather than one being guessed at.
export const lanViewerUrls = (port: number): string[] =>
  localAddresses().map((host) => viewerUrl(`http://${host}:${port}`));

export type ViewerServerHandle = { stop: () => void; port: number };

// Name is scoped to this app so it cannot collide with a cookie the same
// host:port served in a previous life. Path-scoped to the app sub-path for the
// same reason.
const COOKIE_NAME = 'msl_viewer';

const cookieToken = (req: Request): string | null => {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=');
  }
  return null;
};

// HttpOnly so the token is never readable from the page — the viewer bundle
// never needs it, and a token in JS reach is a token that can be exfiltrated by
// anything injected into the DOM. SameSite=Lax so a QR scan (a top-level
// navigation) still carries it. Secure only in tunnel mode: LAN mode is plain
// HTTP, where a Secure cookie would simply be dropped.
const cookieHeader = (mode: ViewerMode): string =>
  `${COOKIE_NAME}=${VIEWER_TOKEN}; Path=${BASE_PATH}; HttpOnly; SameSite=Lax; Max-Age=86400` +
  (mode === 'tunnel' ? '; Secure' : '');

/**
 * Start the viewer server, or throw with a message meant for the user: the only
 * place this can be surfaced is the host page's Remote Monitoring panel.
 */
export const startViewerServer = (assets: Assets, mode: ViewerMode): ViewerServerHandle => {
  try {
    const http = Bun.serve({
      // LAN mode is the only case that binds beyond loopback. In tunnel mode
      // cloudflared is the sole client and it connects locally, so nothing is
      // listening on the network at all.
      hostname: mode === 'lan' ? '0.0.0.0' : '127.0.0.1',
      port: VIEWER_PORT,
      // Viewer sockets are push-only, so a quiet measurement would otherwise
      // look idle and be closed after 120s.
      idleTimeout: 0,
      fetch(req, srv) {
        // Network scope first: an address outside the allowlist gets the same
        // answer for every path, so the port reveals nothing about what is
        // behind it.
        if (!isAllowedRemote(srv.requestIP(req)?.address, mode)) {
          return new Response('Forbidden', { status: 403 });
        }

        const url = new URL(req.url);
        const path = decodeURIComponent(url.pathname);

        // The token, from the URL on the first request and from the cookie it
        // sets thereafter. Checked for *every* path including the app shell —
        // over a tunnel the URL is public, so an unauthorised visitor must not
        // even learn that this is a Modbus logger.
        const presented = url.searchParams.get('k') ?? cookieToken(req);
        if (presented !== VIEWER_TOKEN) {
          return new Response('Forbidden', { status: 403 });
        }
        // Only the URL form needs to hand back a cookie; re-setting it on every
        // asset would rewrite the expiry on each request for no benefit.
        const setCookie = url.searchParams.has('k') ? cookieHeader(mode) : null;

        if (path === VIEWER_PATH) {
          if (srv.upgrade(req)) return undefined;
          return new Response('Expected a WebSocket upgrade', { status: 426 });
        }

        const response = serveStatic(assets, path, req, 'viewer');
        if (setCookie) response.headers.append('Set-Cookie', setCookie);
        return response;
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

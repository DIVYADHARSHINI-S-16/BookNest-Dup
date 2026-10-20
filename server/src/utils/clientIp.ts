/**
 * Turns a client address (as reported by Express `req.ip`) into the key a rate
 * limiter counts against. Pure: no I/O, no dependencies.
 *
 *  - IPv4 and IPv4-mapped IPv6 (`::ffff:1.2.3.4`) -> the plain IPv4 address.
 *  - Other IPv6 addresses -> their /64 prefix. One household or host usually
 *    controls a whole /64 (2^64 addresses), so counting full IPv6 addresses
 *    would let a single client dodge the limit just by rotating addresses.
 *  - Anything unparseable -> the lower-cased text itself (never throws).
 *  - Missing -> "unknown" (all such requests share one bucket).
 *
 * `req.ip` already honours the app's "trust proxy" setting, so this function
 * never looks at X-Forwarded-For itself.
 */
export function clientKeyFromIp(ip: string | undefined | null): string {
  if (typeof ip !== "string") return "unknown";
  let value = ip.trim().toLowerCase();
  if (value === "") return "unknown";

  const zone = value.indexOf("%");
  if (zone !== -1) value = value.slice(0, zone);

  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(value);
  if (mapped) return mapped[1];

  if (!value.includes(":")) return value; // IPv4 (or an unexpected token): use as-is

  const prefix = ipv6Prefix64(value);
  return prefix ?? value;
}

function ipv6Prefix64(value: string): string | null {
  // Embedded dotted IPv4 (e.g. 64:ff9b::1.2.3.4) is rare; keep the full text rather than guess.
  if (value.includes(".")) return null;

  const halves = value.split("::");
  if (halves.length > 2) return null;

  const head = halves[0] === "" ? [] : halves[0].split(":");
  const tail = halves.length === 2 ? (halves[1] === "" ? [] : halves[1].split(":")) : [];

  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array(missing).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;

  return "v6:" + groups.slice(0, 4).map((g) => g.padStart(4, "0")).join(":") + "/64";
}

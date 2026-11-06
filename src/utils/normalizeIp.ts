// Dual-stack sockets report IPv4 clients as IPv4-mapped IPv6 (::ffff:a.b.c.d).
export const normalizeIp = (ip?: string) =>
  ip?.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");

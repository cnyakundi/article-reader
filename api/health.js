export default function handler(_req, res) {
  const body = JSON.stringify({ ok: true });
  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(body));
  res.end(body);
}

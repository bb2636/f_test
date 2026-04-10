import crypto from "crypto";
import https from "https";

export function createSolapiAuthHeader(apiKey: string, apiSecret: string): string {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(32).toString("hex");
  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

export function solapiHttpsRequest({
  method,
  path,
  headers,
  body,
}: {
  method: string;
  path: string;
  headers: Record<string, string | number>;
  body?: string;
}): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.solapi.com",
        port: 443,
        method,
        path,
        headers,
        timeout: 15000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const json = data ? JSON.parse(data) : {};
            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              return resolve(json);
            }
            reject({ statusCode: res.statusCode, body: json });
          } catch {
            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              return resolve({ raw: data });
            }
            reject({ statusCode: res.statusCode, body: data });
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("REQUEST_TIMEOUT")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

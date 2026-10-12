// Signs the anon and service-role keys for the local stack (HS256 JWTs, as Supabase issues them).
import { createHmac } from "node:crypto";
const secret = process.argv[2];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (role) => {
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: "supabase", role, iat: 1700000000, exp: 2000000000 })}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
};
console.log(`ANON_KEY=${sign("anon")}\nSERVICE_ROLE_KEY=${sign("service_role")}`);

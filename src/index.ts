import app from "./app";
import { env } from "./config/env";
import { connectDb } from "./config/db";

async function start() {
  await connectDb();
  app.listen(env.port, () => {
    console.log(`API running on port ${env.port}`);
  });
}

start().catch((err) => {
  console.error("Startup failed", err);
  process.exit(1);
});

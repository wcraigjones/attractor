#!/usr/bin/env node

import { randomBytes, scryptSync } from "node:crypto";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline";

const DEFAULT_COST = 16384;
const DEFAULT_BLOCK_SIZE = 8;
const DEFAULT_PARALLELIZATION = 1;
const DEFAULT_DERIVED_KEY_LENGTH = 32;

function createPasswordHash(password) {
  const salt = randomBytes(16);
  const derivedKey = scryptSync(password, salt, DEFAULT_DERIVED_KEY_LENGTH, {
    N: DEFAULT_COST,
    r: DEFAULT_BLOCK_SIZE,
    p: DEFAULT_PARALLELIZATION
  });
  return `scrypt$${DEFAULT_COST}$${DEFAULT_BLOCK_SIZE}$${DEFAULT_PARALLELIZATION}$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

async function readPasswordFromPrompt() {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("interactive prompt requires a TTY");
  }

  const rl = readline.createInterface({ input, output, terminal: true });
  output.write("Password: ");
  input.setRawMode(true);
  input.resume();

  return await new Promise((resolve, reject) => {
    let password = "";

    const cleanup = () => {
      input.setRawMode(false);
      input.removeListener("data", onData);
      rl.close();
      output.write("\n");
    };

    const onData = (chunk) => {
      const value = chunk.toString("utf8");

      if (value === "\u0003") {
        cleanup();
        reject(new Error("cancelled"));
        return;
      }

      if (value === "\r" || value === "\n") {
        cleanup();
        resolve(password);
        return;
      }

      if (value === "\u007f") {
        password = password.slice(0, -1);
        return;
      }

      password += value;
    };

    input.on("data", onData);
  });
}

async function readPassword() {
  if (input.isTTY) {
    const password = await readPasswordFromPrompt();
    return password.trim();
  }

  let data = "";
  for await (const chunk of input) {
    data += chunk.toString();
  }
  return data.trim();
}

try {
  const password = await readPassword();
  if (!password) {
    throw new Error("password is required");
  }

  const hash = createPasswordHash(password);
  output.write(`FACTORY_AUTH_BASIC_PASSWORD_HASH=${hash}\n`);
  output.write(`helm --set auth.basic.passwordHash='${hash}'\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exitCode = 1;
}

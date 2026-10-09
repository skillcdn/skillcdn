#!/usr/bin/env node
import process from "node:process";
import { runCli } from "./cli.js";

// The only place that touches the process: everything else takes what it needs as arguments.
process.exitCode = await runCli(process.argv.slice(2), {
  environment: process.env,
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
});

import type { NextConfig } from "next";

// AGENTS.md holds this repo's own instructions; stop `next dev` from writing its rules into it.
const config: NextConfig = { agentRules: false };

export default config;

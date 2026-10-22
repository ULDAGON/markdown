import type { NextConfig } from "next";

const config: NextConfig = {
  // AGENTS.md holds this repo's own instructions; stop `next dev` from writing its rules into it.
  agentRules: false,
  // The dev badge sits on top of the status bar.
  devIndicators: false,
};

export default config;

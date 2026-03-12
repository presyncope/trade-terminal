import React from "react";
import { BacktestConfig } from "./BacktestConfig";
import { StrategyLeaderboard } from "../Trading/StrategyLeaderboard";

export function BacktestPage() {

  return (
    <div style={styles.root}>
      <BacktestConfig />
      <div style={styles.leaderboard}>
        <StrategyLeaderboard />
      </div>
    </div>
  );
}

const styles = {
  root: {
    height: "100%",
    display: "flex" as const,
    flexDirection: "row" as const,
    overflow: "hidden",
  },
  leaderboard: {
    flex: 1,
    overflow: "hidden",
    display: "flex" as const,
    flexDirection: "column" as const,
  },
};

process.env.UPBIT_MARKET_COUNT = process.env.UPBIT_MARKET_COUNT ?? "30";
process.env.UPBIT_LOOKBACK_DAYS = process.env.UPBIT_LOOKBACK_DAYS ?? "90";
process.env.UPBIT_CANDLE_UNIT = process.env.UPBIT_CANDLE_UNIT ?? "5";
process.env.UPBIT_PRETTY_JSON = process.env.UPBIT_PRETTY_JSON ?? "false";

await import("./fetch-upbit-market-data.mjs");

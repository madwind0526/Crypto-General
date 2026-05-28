import "dotenv/config";
import { fetchTickers } from "../src/data/upbitClient";
import { getAccounts } from "./upbitOrder";

const ACCESS_KEY = process.env.UPBIT_ACCESS_KEY ?? "";
const SECRET_KEY = process.env.UPBIT_SECRET_KEY ?? "";

const accounts = await getAccounts(ACCESS_KEY, SECRET_KEY);
const relevant = accounts.filter((a) => parseFloat(a.balance) + parseFloat(a.locked) > 0);

// 코인 목록으로 현재 시세 조회 (KRW 거래쌍 없는 코인은 건너뜀)
import { fetchKrwMarkets } from "../src/data/upbitClient";
const coinAccounts = relevant.filter((a) => a.currency !== "KRW");
const krwMarkets = new Set((await fetchKrwMarkets()).map((m) => m.market));
const markets = coinAccounts.map((a) => `KRW-${a.currency}`).filter((m) => krwMarkets.has(m));
const tickers = markets.length > 0 ? await fetchTickers(markets) : [];
const priceMap = new Map(tickers.map((t) => [t.market.replace("KRW-", ""), t.tradePrice]));

console.log("=".repeat(65));
console.log("업비트 잔고  (현재가 기준)");
console.log("=".repeat(65));

let totalKrwValue = 0;
for (const a of relevant) {
  const bal = parseFloat(a.balance);
  const locked = parseFloat(a.locked);
  const total = bal + locked;
  const lockedStr = locked > 0 ? ` (대기: ${locked.toFixed(8)})` : "";

  if (a.currency === "KRW") {
    totalKrwValue += total;
    console.log(`  KRW      ${Math.floor(total).toLocaleString()}원${lockedStr}`);
  } else {
    const currentPrice = priceMap.get(a.currency) ?? 0;
    const avgBuyPrice = parseFloat(a.avg_buy_price);
    const krwVal = total * currentPrice;
    const profit = avgBuyPrice > 0 ? ((currentPrice - avgBuyPrice) / avgBuyPrice) * 100 : null;
    const profitStr = profit !== null ? ` (${profit >= 0 ? "+" : ""}${profit.toFixed(2)}%)` : "";
    totalKrwValue += krwVal;

    console.log(
      `  ${a.currency.padEnd(8)} ${total.toLocaleString(undefined, { maximumSignificantDigits: 8 })} 개` +
      `  |  현재가: ${currentPrice.toLocaleString()}원` +
      `  |  평가: ${Math.floor(krwVal).toLocaleString()}원${profitStr}${lockedStr}`,
    );
  }
}

console.log("-".repeat(65));
console.log(`  총 평가액  ${Math.floor(totalKrwValue).toLocaleString()}원`);

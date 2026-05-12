import type { Candle, MarketSnapshot } from "../types/trading";

const UPBIT_BASE_URL = "https://api.upbit.com";

interface UpbitMarketResponse {
  market: string;
  korean_name: string;
  english_name: string;
}

interface UpbitCandleResponse {
  market: string;
  candle_date_time_utc: string;
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;
  timestamp: number;
  candle_acc_trade_price: number;
  candle_acc_trade_volume: number;
}

interface UpbitTickerResponse {
  market: string;
  trade_price: number;
  acc_trade_price_24h: number;
  acc_trade_volume_24h: number;
  signed_change_rate: number;
}

export interface UpbitMarket {
  market: string;
  koreanName: string;
  englishName: string;
}

export async function fetchKrwMarkets(): Promise<UpbitMarket[]> {
  const response = await fetch(`${UPBIT_BASE_URL}/v1/market/all?isDetails=false`);
  if (!response.ok) throw new Error(`Upbit markets request failed: ${response.status}`);
  const markets = (await response.json()) as UpbitMarketResponse[];

  return markets
    .filter((market) => market.market.startsWith("KRW-"))
    .map((market) => ({
      market: market.market,
      koreanName: market.korean_name,
      englishName: market.english_name,
    }));
}

export async function fetchMinuteCandles(
  market: string,
  unit: 1 | 3 | 5 | 10 | 15 | 30 | 60 | 240,
  count = 200,
  to?: Date,
): Promise<Candle[]> {
  const params = new URLSearchParams({
    market,
    count: String(count),
  });
  if (to) params.set("to", to.toISOString());

  const response = await fetch(`${UPBIT_BASE_URL}/v1/candles/minutes/${unit}?${params.toString()}`);
  if (!response.ok) throw new Error(`Upbit candle request failed: ${response.status}`);
  const candles = (await response.json()) as UpbitCandleResponse[];

  return candles
    .map((candle) => ({
      market: candle.market,
      timestamp: candle.timestamp,
      open: candle.opening_price,
      high: candle.high_price,
      low: candle.low_price,
      close: candle.trade_price,
      volume: candle.candle_acc_trade_volume,
      quoteVolume: candle.candle_acc_trade_price,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export async function fetchTickers(markets: string[]): Promise<MarketSnapshot[]> {
  if (markets.length === 0) return [];
  const params = new URLSearchParams({ markets: markets.join(",") });
  const response = await fetch(`${UPBIT_BASE_URL}/v1/ticker?${params.toString()}`);
  if (!response.ok) throw new Error(`Upbit ticker request failed: ${response.status}`);
  const tickers = (await response.json()) as UpbitTickerResponse[];

  return tickers.map((ticker) => ({
    market: ticker.market,
    tradePrice: ticker.trade_price,
    accTradePrice24h: ticker.acc_trade_price_24h,
    accTradeVolume24h: ticker.acc_trade_volume_24h,
    signedChangeRate: ticker.signed_change_rate,
  }));
}


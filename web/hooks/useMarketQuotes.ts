"use client";

import { useEffect, useState } from "react";
import { fetchBestQuotes, type QuoteBook, subscribeToMarketQuotes } from "@/lib/quote-relay";

const EMPTY: QuoteBook = { yes: [], no: [] };

export function useMarketQuotes(marketId: string | null): QuoteBook {
  const [book, setBook] = useState<QuoteBook>(EMPTY);

  useEffect(() => {
    if (!marketId) {
      setBook(EMPTY);
      return;
    }
    const id = BigInt(marketId);
    let cancelled = false;

    fetchBestQuotes(id).then((b) => {
      if (!cancelled) setBook(b);
    });
    const unsubscribe = subscribeToMarketQuotes(id, (b) => {
      if (!cancelled) setBook(b);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [marketId]);

  return book;
}

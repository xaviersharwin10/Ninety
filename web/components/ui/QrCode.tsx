"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

export function QrCode({ value, size = 180 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 1,
      color: { dark: "#06070a", light: "#f5f6f8" },
    }).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!dataUrl) {
    return <div className="shimmer rounded-2xl" style={{ width: size, height: size }} />;
  }

  return (
    <img
      src={dataUrl}
      width={size}
      height={size}
      className="rounded-2xl border border-border"
      alt="QR code linking to this page"
    />
  );
}

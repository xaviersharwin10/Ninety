import type { MetadataRoute } from "next";

/**
 * Makes Ninety installable: "Add to Home Screen" gives it an icon and opens it full-screen, like an
 * app, with no app store involved.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ninety",
    short_name: "Ninety",
    description: "Every minute of a live football match becomes a market.",
    start_url: "/home",
    display: "standalone",
    background_color: "#06070a",
    theme_color: "#06070a",
    orientation: "portrait",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

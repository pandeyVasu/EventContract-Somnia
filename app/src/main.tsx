import React from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { wagmiConfig } from "./chain/wagmi.ts";
import { App } from "./ui/App.tsx";
import "./index.css";

const queryClient = new QueryClient();

const root = document.getElementById("root");
if (!root) throw new Error("no #root element");

createRoot(root).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);

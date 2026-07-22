import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "./hooks/useTheme";
import { LangProvider } from "./i18n/useLang";
import App from "./App";
import "./index.css";

// Included in the compiled entry module. Change VITE_BUILD_ID for a release
// when a WebView has cached an earlier failed response for a hashed asset URL.
document.documentElement.dataset.buildId = import.meta.env.VITE_BUILD_ID || "local";

const client = new QueryClient();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <LangProvider>
          <App />
        </LangProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
